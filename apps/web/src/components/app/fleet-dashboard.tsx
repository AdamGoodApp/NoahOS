import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  CheckboxGroup,
  ClickableTile,
  Column,
  ContentSwitcher,
  DataTable,
  Dropdown,
  Grid,
  HeaderGlobalAction,
  IconSwitch,
  Link,
  NumberInput,
  preview__IconIndicator as IconIndicator,
  RadioButton,
  RadioButtonGroup,
  Search,
  SelectableTag,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react'
import {
  Add,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  Plug,
  Filter,
  Grid as GridIcon,
  List,
  Notification,
  Search as SearchIcon,
} from '@carbon/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { flushSync } from 'react-dom'

import { useRegisterCapability, type FleetApi } from '@/lib/agent/registry'
import { AppHeader, isPlainClick } from './app-header'
import { AgeReading, STATUS_KIND, statusText } from './robot-status'
import {
  CATEGORIES,
  FLEET,
  SITES,
  STATUS_LABEL,
  STATUS_ORDER,
  type Robot,
  type RobotCategory,
  type RobotStatus,
} from './fleet-data'

export type StatusFilter = RobotStatus | 'all'
export type SortKey = 'status' | 'battery' | 'name' | 'seen'
export type View = 'grid' | 'list'

const SORT_ITEMS: { id: SortKey; text: string }[] = [
  { id: 'status', text: 'Status' },
  { id: 'battery', text: 'Battery' },
  { id: 'name', text: 'Name' },
  { id: 'seen', text: 'Last seen' },
]

const SORTERS: Record<SortKey, (a: Robot, b: Robot) => number> = {
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
  battery: (a, b) => (a.battery ?? 101) - (b.battery ?? 101),
  name: (a, b) => a.name.localeCompare(b.name),
  seen: (a, b) => a.lastSeenSec - b.lastSeenSec,
}

const OPERATORS = [...new Set(FLEET.flatMap((r) => (r.operator ? [r.operator] : [])))].sort()

const FAULTS = FLEET.filter((r) => r.status === 'fault').length

const TABLE_HEADERS = [
  { key: 'name', header: 'Robot' },
  { key: 'where', header: 'Type, site and activity' },
  { key: 'status', header: 'Status' },
  { key: 'battery', header: 'Battery' },
  { key: 'seen', header: 'Last seen' },
]

export function FleetDashboard() {
  const navigate = useNavigate()
  const openRobot = (id: string) => (e: SyntheticEvent) => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    navigate({ to: '/app/robots/$id', params: { id } })
  }
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sites, setSites] = useState<string[]>([])
  const [categories, setCategories] = useState<RobotCategory[]>([])
  const [operators, setOperators] = useState<string[]>([])
  const [batteryMin, setBatteryMin] = useState(0)
  const [batteryMax, setBatteryMax] = useState(100)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('status')
  const [view, setView] = useState<View>('grid')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const activeFilters =
    (status !== 'all' ? 1 : 0) +
    (sites.length ? 1 : 0) +
    (categories.length ? 1 : 0) +
    (operators.length ? 1 : 0) +
    (batteryMin > 0 || batteryMax < 100 ? 1 : 0)

  const clearFilters = () => {
    setStatus('all')
    setSites([])
    setCategories([])
    setOperators([])
    setBatteryMin(0)
    setBatteryMax(100)
    setQuery('')
  }

  // Everything except the status filter, so status counts reflect the other filters.
  const baseMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return FLEET.filter(
      (r) =>
        (!sites.length || sites.includes(r.site)) &&
        (!categories.length || categories.includes(r.category)) &&
        (!operators.length || (r.operator && operators.includes(r.operator))) &&
        (r.battery === null ? batteryMin === 0 && batteryMax === 100 : r.battery >= batteryMin && r.battery <= batteryMax) &&
        (!q || [r.name, r.site, r.activity, r.category, r.operator ?? ''].some((s) => s.toLowerCase().includes(q))),
    )
  }, [sites, categories, operators, batteryMin, batteryMax, query])

  const statusCounts = useMemo(() => {
    const counts = new Map<RobotStatus, number>()
    for (const r of baseMatches) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
    return counts
  }, [baseMatches])

  const robots = useMemo(() => {
    const list = status === 'all' ? baseMatches : baseMatches.filter((r) => r.status === status)
    return [...list].sort(SORTERS[sort])
  }, [baseMatches, status, sort])

  // The assistant's filter_fleet tool: reads the latest render through a ref, sets filters through the setters.
  const latest = { filters: { status, sites, categories, operators, batteryMin, batteryMax, query, sort, view }, baseMatches, statusCounts, robots, clearFilters }
  const agent = useRef(latest)
  agent.current = latest
  const fleetApi = useMemo<FleetApi>(() => {
    const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n)))
    return {
      getState: () => {
        const { filters, baseMatches, statusCounts, robots } = agent.current
        const counts = { all: baseMatches.length } as Record<StatusFilter, number>
        for (const s of STATUS_ORDER) counts[s] = statusCounts.get(s) ?? 0
        return { ...filters, counts, visible: robots.map((r) => ({ id: r.id, name: r.name })) }
      },
      // flushSync: getState() right after reflects the new filters.
      setFilters: (patch) =>
        flushSync(() => {
        if (patch.status !== undefined) setStatus(patch.status)
        if (patch.sites !== undefined) setSites(patch.sites)
        if (patch.categories !== undefined) setCategories(patch.categories)
        if (patch.operators !== undefined) setOperators(patch.operators)
        if (patch.batteryMin !== undefined) setBatteryMin(clampPct(patch.batteryMin))
        if (patch.batteryMax !== undefined) setBatteryMax(clampPct(patch.batteryMax))
        if (patch.query !== undefined) setQuery(patch.query)
        if (patch.sort !== undefined) setSort(patch.sort)
        if (patch.view !== undefined) setView(patch.view)
        }),
      clear: () => flushSync(() => agent.current.clearFilters()),
    }
  }, [])
  useRegisterCapability('fleet', fleetApi)

  const filters = (idPrefix: string) => (
    <Accordion size="md">
      <AccordionItem title="Status" open>
        <RadioButtonGroup
          legendText={<span className="fleet-sr-only">Robot status</span>}
          name={`${idPrefix}-status`}
          orientation="vertical"
          valueSelected={status}
          onChange={(v) => setStatus(v as StatusFilter)}
        >
          {(['all', ...STATUS_ORDER] as StatusFilter[]).map((s) => {
            const count = s === 'all' ? baseMatches.length : (statusCounts.get(s) ?? 0)
            return (
              <RadioButton
                key={s}
                id={`${idPrefix}-status-${s}`}
                value={s}
                labelText={`${s === 'all' ? 'All' : STATUS_LABEL[s]} (${count})`}
              />
            )
          })}
        </RadioButtonGroup>
      </AccordionItem>
      <AccordionItem title="Site" open>
        <div className="fleet-tag-group" role="group" aria-label="Site">
          {SITES.map((s) => (
            <SelectableTag
              key={s}
              id={`${idPrefix}-site-${s}`}
              text={s}
              selected={sites.includes(s)}
              onChange={() => setSites(toggle(sites, s))}
            />
          ))}
        </div>
      </AccordionItem>
      <AccordionItem title="Battery" open>
        <div className="fleet-battery">
          <NumberInput
            id={`${idPrefix}-battery-min`}
            label="Minimum %"
            min={0}
            max={100}
            step={5}
            size="sm"
            value={batteryMin}
            onChange={(_e, { value }) => setBatteryMin(Math.min(Number(value) || 0, batteryMax))}
          />
          <NumberInput
            id={`${idPrefix}-battery-max`}
            label="Maximum %"
            min={0}
            max={100}
            step={5}
            size="sm"
            value={batteryMax}
            onChange={(_e, { value }) => setBatteryMax(Math.max(Number(value) || 0, batteryMin))}
          />
        </div>
      </AccordionItem>
      <AccordionItem title="Type">
        <CheckboxGroup legendText={<span className="fleet-sr-only">Robot type</span>}>
          {CATEGORIES.map((m) => (
            <Checkbox
              key={m}
              id={`${idPrefix}-type-${m.replace(/\s+/g, '-')}`}
              labelText={m}
              checked={categories.includes(m)}
              onChange={() => setCategories(toggle(categories, m))}
            />
          ))}
        </CheckboxGroup>
      </AccordionItem>
      <AccordionItem title="Operator">
        <CheckboxGroup legendText={<span className="fleet-sr-only">Operator</span>}>
          {OPERATORS.map((o) => (
            <Checkbox
              key={o}
              id={`${idPrefix}-operator-${o}`}
              labelText={o}
              checked={operators.includes(o)}
              onChange={() => setOperators(toggle(operators, o))}
            />
          ))}
        </CheckboxGroup>
      </AccordionItem>
    </Accordion>
  )

  const clearAll = (
    <Button kind="ghost" size="sm" onClick={clearFilters} disabled={activeFilters === 0 && !query}>
      Clear all
    </Button>
  )

  return (
    <>
      <AppHeader
        skipTo="#fleet-robots"
        actions={
          <>
            <HeaderGlobalAction
              aria-label="Search robots"
              onClick={() => searchRef.current?.querySelector('input')?.focus()}
            >
              <SearchIcon size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label={FAULTS ? `${FAULTS} robot${FAULTS > 1 ? 's' : ''} with a fault` : 'No faults'}
              onClick={() => setStatus('fault')}
            >
              <Notification size={20} />
            </HeaderGlobalAction>
          </>
        }
      />

      <div className="fleet-shell">
        <aside className="fleet-filters" aria-label="Filters">
          <div className="fleet-filters__head">
            <h2 className="fleet-filters__title">Filters ({activeFilters})</h2>
            {clearAll}
          </div>
          {filters('side')}
        </aside>

        <div className="fleet-main">
          <div className="fleet-toolbar">
            <div className="fleet-toolbar__search" ref={searchRef}>
              <Search
                id="fleet-search"
                labelText="Search robots"
                placeholder="Search robots, sites, tasks"
                size="lg"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="fleet-toolbar__sort">
              <Dropdown
                id="fleet-sort"
                titleText="Sort by"
                hideLabel
                label="Sort by"
                size="lg"
                items={SORT_ITEMS}
                itemToString={(item) => (item ? `Sort: ${item.text}` : '')}
                selectedItem={SORT_ITEMS.find((i) => i.id === sort)}
                onChange={({ selectedItem }) => selectedItem && setSort(selectedItem.id)}
              />
            </div>
            <ContentSwitcher
              size="lg"
              selectedIndex={view === 'grid' ? 0 : 1}
              onChange={({ name }) => setView(name as View)}
            >
              <IconSwitch name="grid" text="Grid view" align="bottom">
                <GridIcon />
              </IconSwitch>
              <IconSwitch name="list" text="List view" align="bottom">
                <List />
              </IconSwitch>
            </ContentSwitcher>
            <Button
              kind="primary"
              size="lg"
              renderIcon={Add}
              disabled
              title="Adding robots arrives with fleet setup"
            >
              Add robot
            </Button>
            <Button
              className="fleet-toolbar__filters-toggle"
              kind="tertiary"
              size="lg"
              renderIcon={Filter}
              aria-expanded={filtersOpen}
              aria-controls="fleet-mobile-filters"
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              Filters ({activeFilters})
            </Button>
          </div>

          <main id="fleet-robots" className="fleet-list" tabIndex={-1}>
            <h1 className="fleet-sr-only">Fleet dashboard</h1>
            {filtersOpen && (
              <div id="fleet-mobile-filters" className="fleet-mobile-filters">
                <div className="fleet-filters__head">
                  <span className="fleet-filters__title">Filters ({activeFilters})</span>
                  {clearAll}
                </div>
                {filters('mobile')}
              </div>
            )}

            {robots.length === 0 ? (
              <div className="fleet-empty">
                <p>No robots match these filters.</p>
                <Button kind="tertiary" size="md" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            ) : view === 'grid' ? (
              <Grid narrow fullWidth withRowGap as="ul" aria-label="Robots">
                {robots.map((r) => (
                  <Column key={r.id} as="li" sm={4} md={4} lg={4}>
                    <RobotTile robot={r} onOpen={openRobot(r.id)} />
                  </Column>
                ))}
              </Grid>
            ) : (
              <Grid fullWidth>
                <Column sm={4} md={8} lg={16}>
                  <RobotTable robots={robots} onOpen={openRobot} />
                </Column>
              </Grid>
            )}
          </main>
        </div>
      </div>
    </>
  )
}

function RobotTile({ robot: r, onOpen }: { robot: Robot; onOpen: (e: SyntheticEvent) => void }) {
  const stale = r.status === 'offline'
  return (
    <ClickableTile className="robot-tile" href={`/app/robots/${r.id}`} onClick={onOpen}>
      <img className="robot-tile__media" src={r.image} alt="" loading="lazy" />
      <div className="robot-tile__line">
        <div className="robot-tile__text">
          <h2 className="robot-tile__name">{r.name}</h2>
          <p className="robot-tile__meta">
            {r.category} · {r.site}
          </p>
          <p className="robot-tile__meta">{r.activity}</p>
        </div>
        <BatteryReading robot={r} stale={stale} />
      </div>
      <div className="robot-tile__footer">
        <IconIndicator kind={STATUS_KIND[r.status]} label={statusText(r)} />
        <AgeReading robot={r} stale={stale} />
      </div>
    </ClickableTile>
  )
}

function RobotTable({ robots, onOpen }: { robots: Robot[]; onOpen: (id: string) => (e: SyntheticEvent) => void }) {
  const byId = new Map(robots.map((r) => [r.id, r]))
  const rows = robots.map((r) => ({ id: r.id, name: r.name, where: '', status: '', battery: '', seen: '' }))
  return (
    <DataTable rows={rows} headers={TABLE_HEADERS}>
      {({ rows: tableRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} aria-label="Robots" size="md">
            <TableHead>
              <TableRow>
                {headers.map((header) => {
                  const { key, ...props } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...props}>
                      {header.header}
                    </TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {tableRows.map((row) => {
                const r = byId.get(row.id)!
                const stale = r.status === 'offline'
                const { key, ...rowProps } = getRowProps({ row })
                return (
                  <TableRow key={key} {...rowProps}>
                    <TableCell>
                      <Link href={`/app/robots/${r.id}`} onClick={onOpen(r.id)}>
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.category} · {r.site} · {r.activity}
                    </TableCell>
                    <TableCell>
                      <IconIndicator kind={STATUS_KIND[r.status]} label={statusText(r)} />
                    </TableCell>
                    <TableCell>
                      <BatteryReading robot={r} stale={stale} />
                    </TableCell>
                    <TableCell>
                      <AgeReading robot={r} stale={stale} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  )
}

function BatteryReading({ robot: r, stale }: { robot: Robot; stale: boolean }) {
  if (r.battery === null)
    return (
      <span className="robot-reading" title="Runs on mains power">
        <Plug size={16} aria-hidden />
        Mains
      </span>
    )
  const Icon = r.status === 'charging' ? BatteryCharging : r.battery < 25 ? BatteryLow : BatteryFull
  return (
    <span className={stale ? 'robot-reading robot-reading--stale' : 'robot-reading'} title={stale ? 'Last known charge' : 'Battery'}>
      <Icon size={16} aria-hidden />
      {r.battery}%<span className="fleet-sr-only">{stale ? ' battery, last known' : ' battery'}</span>
    </span>
  )
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}
