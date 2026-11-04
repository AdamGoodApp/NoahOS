import {
  Button,
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
} from '@carbon/react'

import type { LiveEvent } from '@/lib/live/client'
import { EVENT_LABEL, clockTime } from './live-tiles'

const HEADERS = [
  { key: 'time', header: 'Time' },
  { key: 'kind', header: 'Kind' },
  { key: 'message', header: 'Message' },
]

/** Session events, newest first (STACK.md §7.6). Kept in the live client, so they survive tab switches. */
export function LogsTab({ events, onClear }: { events: LiveEvent[]; onClear(): void }) {
  const rows = events.map((e) => ({ id: String(e.id), time: clockTime(e.at), kind: EVENT_LABEL[e.kind], message: e.message }))
  return (
    <div className="logs-tab">
      <DataTable rows={rows} headers={HEADERS} size="sm">
        {({ rows: tableRows, headers, getTableProps, getHeaderProps, getRowProps, getTableContainerProps }) => (
          <TableContainer title="Session log" description="Connection, control and simulation events" {...getTableContainerProps()}>
            <TableToolbar aria-label="Log actions">
              <TableToolbarContent>
                <Button kind="ghost" size="sm" disabled={!events.length} onClick={onClear}>
                  Clear
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()}>
              <TableHead>
                <TableRow>
                  {headers.map((h) => {
                    const { key, ...rest } = getHeaderProps({ header: h })
                    return (
                      <TableHeader key={key} {...rest}>
                        {h.header}
                      </TableHeader>
                    )
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={HEADERS.length}>No events yet</TableCell>
                  </TableRow>
                ) : (
                  tableRows.map((row) => {
                    const { key, ...rest } = getRowProps({ row })
                    return (
                      <TableRow key={key} {...rest}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>
    </div>
  )
}
