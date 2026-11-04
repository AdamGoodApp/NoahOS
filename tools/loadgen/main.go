// Command loadgen opens N viewer WebSockets on one robot and reports telemetry fan-out latency
// (STACK.md §10 Phase 7): latency = arrival time − Telemetry.sent_unix_ns, corrected per client by a
// ping/pong clock offset so it also works when the sim's clock differs from this machine's.
package main

import (
	"context"
	"flag"
	"fmt"
	"math"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	simv1 "noahos/loadgen/gen/noahos/sim/v1"
)

type result struct {
	frames    int
	drops     uint64
	latencies []float64 // ms
	err       error
}

func main() {
	base := flag.String("url", "ws://localhost:3000", "relay origin (ws:// or wss://)")
	robot := flag.String("robot", "unitree_g1", "robot id")
	n := flag.Int("n", 50, "viewer connections")
	dur := flag.Duration("d", 10*time.Second, "measurement duration")
	divisor := flag.Uint("divisor", 1, "telemetry_divisor requested by each viewer")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *dur+15*time.Second)
	defer cancel()
	results := make([]result, *n)
	var wg sync.WaitGroup
	start := time.Now()
	for i := range *n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = viewer(ctx, fmt.Sprintf("%s/ws/robots/%s?client=loadgen-%d", *base, *robot, i), fmt.Sprintf("loadgen-%d", i), uint32(*divisor), *dur)
		}(i)
		time.Sleep(5 * time.Millisecond) // stagger connects
	}
	wg.Wait()

	var all []float64
	frames, failed := 0, 0
	var drops uint64
	for _, r := range results {
		if r.err != nil {
			failed++
			fmt.Fprintln(os.Stderr, "viewer error:", r.err)
			continue
		}
		frames += r.frames
		drops += r.drops
		all = append(all, r.latencies...)
	}
	sort.Float64s(all)
	ok := *n - failed
	fmt.Printf("robot=%s viewers=%d ok=%d duration=%s\n", *robot, *n, ok, time.Since(start).Round(time.Millisecond))
	if ok == 0 || len(all) == 0 {
		fmt.Println("no telemetry received")
		os.Exit(1)
	}
	fmt.Printf("frames=%d (%.1f Hz per viewer) drops=%d\n", frames, float64(frames)/float64(ok)/dur.Seconds(), drops)
	fmt.Printf("fan-out latency ms: p50=%.2f p90=%.2f p99=%.2f max=%.2f\n", pct(all, 50), pct(all, 90), pct(all, 99), all[len(all)-1])
}

func pct(sorted []float64, p float64) float64 {
	i := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	return sorted[max(0, min(i, len(sorted)-1))]
}

func send(ctx context.Context, c *websocket.Conn, m *simv1.ClientMessage) error {
	b, err := proto.Marshal(m)
	if err != nil {
		return err
	}
	return c.Write(ctx, websocket.MessageBinary, b)
}

func viewer(ctx context.Context, url, id string, divisor uint32, dur time.Duration) result {
	var r result
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		r.err = err
		return r
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)
	hello := &simv1.ClientMessage{Msg: &simv1.ClientMessage_Hello{Hello: &simv1.Hello{ClientId: id, Role: simv1.Role_ROLE_VIEWER, TelemetryDivisor: divisor}}}
	if r.err = send(ctx, c, hello); r.err != nil {
		return r
	}
	// Clock offset (sim − local, ms) from ping/pong, refreshed every 500 ms; frames before the first pong are skipped.
	var offset float64
	haveOffset := false
	var lastSeq uint64
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			ping := &simv1.ClientMessage{Msg: &simv1.ClientMessage_Ping{Ping: &simv1.Ping{ClientId: id, ClientMs: uint64(time.Now().UnixMilli())}}}
			if send(ctx, c, ping) != nil {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
	end := time.Now().Add(dur)
	for time.Now().Before(end) {
		rctx, cancel := context.WithDeadline(ctx, end)
		_, data, err := c.Read(rctx)
		cancel()
		if err != nil {
			if time.Now().Before(end) {
				r.err = err
			}
			break
		}
		now := float64(time.Now().UnixNano()) / 1e6
		var m simv1.ServerMessage
		if proto.Unmarshal(data, &m) != nil {
			continue
		}
		switch msg := m.Msg.(type) {
		case *simv1.ServerMessage_Pong:
			if msg.Pong.ClientId == id {
				rtt := now - float64(msg.Pong.ClientMs)
				off := float64(msg.Pong.ServerUnixNs)/1e6 - (float64(msg.Pong.ClientMs) + rtt/2)
				if haveOffset {
					offset += 0.3 * (off - offset)
				} else {
					offset, haveOffset = off, true
				}
			}
		case *simv1.ServerMessage_Telemetry:
			t := msg.Telemetry
			if lastSeq != 0 && t.Seq > lastSeq+uint64(divisor) {
				r.drops += (t.Seq - lastSeq - uint64(divisor)) / uint64(divisor)
			}
			lastSeq = t.Seq
			r.frames++
			if haveOffset {
				r.latencies = append(r.latencies, now-(float64(t.SentUnixNs)/1e6-offset))
			}
		}
	}
	c.Close(websocket.StatusNormalClosure, "done")
	return r
}
