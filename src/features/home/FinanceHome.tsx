// The admin Home once the company has a first hire: three answers above the fold (am I legally exposed,
// what are people costing me, what do I need to approve), then the detail (docs/SPEC.md, Home dashboard).
// Top to bottom: the date and a one-line answer; four KPI tiles that jump to their detail; Legal exposure
// and Approvals side by side; then people cost and runway, headcount vs plan, hiring, joining and leaving,
// and two folded sections: the full inbox and This week. Numbers come from the same selectors as the rest
// of the app (dashboard.ts over inboxItems, peopleCostSummary, headcountProjection); nothing is stored.
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { links } from '@/app/router'
import { NOT_LEGAL_ADVICE } from '@/domain/compliance'
import type { InboxAction, InboxItem } from '@/domain/inbox'
import { peopleCostSummary, RUNWAY_CAP_MONTHS, runwayMonthsLabel } from '@/domain/pay'
import type { Viewer } from '@/domain/types'
import { fmtShort, type ISODate } from '@/lib/dates'
import { listJoin, plural } from '@/lib/format'
import { useDB } from '@/store/db'
import { usePrefs } from '@/store/prefs'
import {
  Badge,
  BarList,
  Button,
  buttonClass,
  type Column,
  cx,
  DataTable,
  EmptyState,
  Icon,
  jumpTo,
  KpiSub,
  KpiTile,
  KpiValue,
  Money,
  PageHeader,
  Panel,
  Sparkline,
} from '@/ui'
import {
  approvalsQueue,
  type ApprovalRow,
  headcountTile,
  hiringRows,
  type HiringRow,
  homeAnswer,
  homeDateTitle,
  joiningLeaving,
  LEGAL_WINDOW_DAYS,
  legalExposure,
  type LegalRow,
  type MetaPart,
  type MoveRow,
  waitingOnOthers,
} from './dashboard'
import { type CopyFallback, CopyFallbackModal, InboxView, runAction } from './Inbox'
import { GrowthPanel, ThisWeekPanel } from './panels'

const SECTION = {
  legal: 'home-legal',
  approvals: 'home-approvals',
  cost: 'home-cost',
  headcount: 'home-headcount',
  inbox: 'home-inbox',
} as const

/** A section a KPI tile can jump to: focusable by script only (tabIndex -1), so Tab order is unchanged. */
function Target({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} tabIndex={-1} className={cx('min-w-0 scroll-mt-4', className)}>
      {children}
    </div>
  )
}

function Meta({ parts }: { parts: MetaPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden> · </span>}
          {typeof p === 'string' ? p : <Money value={p.money} short={p.short} suffix={p.suffix} />}
        </span>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Action rows (Legal exposure, Approvals)
// ---------------------------------------------------------------------------------------------

type ActionRowData = { key: string; title: ReactNode; titleText: string; meta: ReactNode; red?: boolean; action: InboxAction }

/** Rows with one inline action each. After an action removes a row, focus moves to the row that took its place. */
function ActionList({ rows, viewer, cap }: { rows: ActionRowData[]; viewer: Viewer; cap?: number }) {
  const listRef = useRef<HTMLUListElement>(null)
  const focusIndex = useRef<number | null>(null)
  const [fallback, setFallback] = useState<CopyFallback>(null)
  const [all, setAll] = useState(false)
  const keys = rows.map((r) => r.key).join('|')
  useEffect(() => {
    if (focusIndex.current == null || !listRef.current) return
    const buttons = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-home-action]'))
    buttons[Math.min(focusIndex.current, buttons.length - 1)]?.focus()
    focusIndex.current = null
  }, [keys])
  const capped = cap != null && rows.length > cap + 1 && !all
  const shown = capped ? rows.slice(0, cap) : rows
  const act = async (i: number, action: InboxAction) => {
    focusIndex.current = action.kind === 'mutate' ? i : null
    const gone = await runAction(action, viewer, setFallback)
    if (!gone) focusIndex.current = null
  }
  return (
    <>
      <ul ref={listRef} className="@container">
        {shown.map((r, i) => (
          <li
            key={r.key}
            className={cx(
              'ft-inboxrow grid gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0 @[400px]:grid-cols-[minmax(0,1fr)_auto] @[400px]:items-center',
              r.red && 'ft-inboxrow--bad relative pl-3 before:absolute before:top-3 before:bottom-3 before:left-0 before:w-[3px] before:rounded-full before:bg-bad',
            )}
          >
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">{r.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">{r.meta}</p>
            </div>
            <div className="flex flex-wrap justify-end">
              {r.action.kind === 'navigate' ? (
                <a href={r.action.href} data-home-action aria-label={`${r.action.label}: ${r.titleText}`} className={buttonClass('secondary', 'md', 'gap-1.5')}>
                  {r.action.label}
                  <Icon name="arrow-right" size={16} className="ft-btn__icon ft-btn__icon--right shrink-0" />
                </a>
              ) : (
                <Button data-home-action aria-label={`${r.action.label}: ${r.titleText}`} onClick={() => void act(i, r.action)}>
                  {r.action.label}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {cap != null && rows.length > cap + 1 && (
        <button
          type="button"
          aria-expanded={!capped}
          onClick={() => setAll((v) => !v)}
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[14px] font-semibold text-accent hover:bg-accent-soft"
        >
          <Icon name={capped ? 'chevron-down' : 'chevron-up'} size={16} />
          {capped ? `Show ${rows.length - cap} more` : 'Show fewer'}
        </button>
      )}
      <CopyFallbackModal fallback={fallback} onClose={() => setFallback(null)} />
    </>
  )
}

function legalRowData(r: LegalRow): ActionRowData {
  const overdue = r.status === 'overdue'
  const titleText = `${r.subject} · ${r.task}`
  return {
    key: r.item.key,
    title: titleText,
    titleText,
    red: overdue,
    action: r.item.primary,
    meta: (
      <>
        <Badge tone={overdue ? 'bad' : 'warn'} icon={overdue ? 'alert' : 'clock'}>
          {overdue ? 'Overdue' : 'Due soon'}
        </Badge>
        <span className="num">{r.when}</span>
        {r.item.waitingOn === 'them' && <span>Waiting on {r.item.waitingOnName ?? 'someone else'}</span>}
      </>
    ),
  }
}

function approvalRowData(r: ApprovalRow): ActionRowData {
  return {
    key: r.item.key,
    title: r.title,
    titleText: r.title,
    action: r.item.primary,
    meta: r.meta.length ? (
      <span>
        <Meta parts={r.meta} />
      </span>
    ) : null,
  }
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-10 items-center gap-1 text-[14px] font-semibold text-accent hover:underline">
      {children}
      <Icon name="arrow-right" size={15} />
    </a>
  )
}

// ---------------------------------------------------------------------------------------------
// Detail tables
// ---------------------------------------------------------------------------------------------

const HIRING_COLUMNS: Array<Column<HiringRow>> = [
  { key: 'role', header: 'Role', cell: (r) => <span className="font-semibold text-ink">{r.title}</span>, sort: (r) => r.title },
  { key: 'applied', header: 'Applied', cell: (r) => r.applied, sort: (r) => r.applied, align: 'right' },
  { key: 'onsite', header: 'Onsite', cell: (r) => r.onsite, sort: (r) => r.onsite, align: 'right' },
  { key: 'days', header: 'Days open', cell: (r) => r.daysOpen ?? '', sort: (r) => r.daysOpen, align: 'right' },
  { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status.tone}>{r.status.text}</Badge>, sort: (r) => r.stuck },
]

const MOVE_COLUMNS: Array<Column<MoveRow>> = [
  { key: 'name', header: 'Person', cell: (r) => <span className="font-semibold text-ink">{r.name}</span>, sort: (r) => r.name },
  { key: 'change', header: 'Change', cell: (r) => r.change, sort: (r) => r.change },
  { key: 'date', header: 'Date', cell: (r) => fmtShort(r.date), sort: (r) => r.date },
  { key: 'checklist', header: 'Checklist', cell: (r) => (r.total ? `${r.done} of ${r.total} done` : 'Not started'), sort: (r) => (r.total ? r.done / r.total : 0), hideBelow: 'sm' },
  { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status.tone}>{r.status.text}</Badge>, sort: (r) => (r.status.tone === 'bad' ? 0 : r.status.tone === 'warn' ? 1 : 2) },
]

/** Today, with hires and offers, and at plan as bars; runway today and at plan. */
function CostRunwayPanel({ cost }: { cost: ReturnType<typeof peopleCostSummary> }) {
  const runway = (m: number | null) => (m == null ? null : Math.min(m, RUNWAY_CAP_MONTHS + 1))
  const now = runway(cost.runwayNow.months)
  const plan = runway(cost.runwayAtPlan.months)
  return (
    <Panel title="People cost and runway" subtitle="Fully loaded W-2 cost a month; contractors are separate." actions={<SectionLink href={links.comp('cost')}>Cost and runway</SectionLink>}>
      <BarList
        ariaLabel="People cost a month"
        items={[
          { key: 'now', label: 'Today', value: cost.now.monthly, display: <Money value={cost.now.monthly} short suffix="/mo" />, sub: plural(cost.now.headcount, 'person', 'people') },
          {
            key: 'with',
            label: 'With hires and offers',
            value: cost.withOffers.monthly,
            display: <Money value={cost.withOffers.monthly} short suffix="/mo" />,
            sub: cost.addedNames.length ? `Adds ${listJoin(cost.addedNames)}` : 'Nobody starting or offered',
          },
          { key: 'plan', label: 'At plan', value: cost.atPlan.monthly, display: <Money value={cost.atPlan.monthly} short suffix="/mo" />, sub: plural(cost.atPlan.headcount, 'person', 'people') },
        ]}
      />
      <h3 className="eyebrow mt-5 mb-2">Runway</h3>
      {now == null ? (
        <p className="text-[14px] text-ink-2">Add cash on hand in Settings to see runway.</p>
      ) : (
        <BarList
          ariaLabel="Runway in months"
          max={Math.max(now, plan ?? 0, 1)}
          items={[
            { key: 'now', label: "At today's burn", value: now, display: runwayMonthsLabel(cost.runwayNow.months ?? 0) },
            ...(plan != null ? [{ key: 'plan', label: 'If the hiring plan lands', value: plan, display: runwayMonthsLabel(cost.runwayAtPlan.months ?? 0) }] : []),
          ]}
        />
      )}
    </Panel>
  )
}

/** Shows or hides a folded section (the full inbox, This week). */
function FoldButton({ name, open, onToggle }: { name: string; open: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" icon={open ? 'chevron-up' : 'chevron-down'} aria-expanded={open} onClick={onToggle}>
      {open ? `Hide ${name}` : `Show ${name}`}
    </Button>
  )
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

export function FinanceHome({ viewer, items, date }: { viewer: Viewer; items: InboxItem[]; date: ISODate }) {
  const db = useDB((s) => s.db)
  const setInboxFilter = usePrefs((s) => s.setInboxFilter)
  const cost = useMemo(() => peopleCostSummary(db, date), [db, date])
  const legal = useMemo(() => legalExposure(db, items, date), [db, items, date])
  const approvals = useMemo(() => approvalsQueue(db, items, date, cost), [db, items, date, cost])
  const head = useMemo(() => headcountTile(db, date), [db, date])
  const hiring = useMemo(() => hiringRows(db, date), [db, date])
  const moves = useMemo(() => joiningLeaving(db, date), [db, date])
  const others = waitingOnOthers(items)
  const [inboxOpen, setInboxOpen] = useState(false)
  const [weekOpen, setWeekOpen] = useState(false)

  const openOthers = () => {
    setInboxFilter('them')
    setInboxOpen(true)
    // The section renders open on the next paint; jump once it is there.
    requestAnimationFrame(() => jumpTo(SECTION.inbox))
  }

  const legalStatus = legal.overdue
    ? { tone: 'bad' as const, word: `${legal.overdue} overdue`, value: legal.overdue }
    : legal.dueSoon
      ? { tone: 'warn' as const, word: 'Due soon', value: legal.dueSoon }
      : { tone: 'good' as const, word: 'All clear', value: 0 }
  const runwayNow = cost.runwayNow.months
  const runwayPlan = cost.runwayAtPlan.months
  const startNames = cost.addedNames.length <= 3 ? listJoin(cost.addedNames) : `${cost.addedNames.length} hires and offers`

  return (
    <>
      <PageHeader eyebrow="Today" title={homeDateTitle(date)} subtitle={homeAnswer(legal.overdue, approvals.length)} />
      <div className="@container flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 @[520px]:grid-cols-2 @[760px]:grid-cols-4" role="group" aria-label="Key figures">
          <KpiTile label="Legal exposure" target={SECTION.legal} jumpLabel="Go to the legal list">
            <span className="mt-1.5">
              <Badge tone={legalStatus.tone} icon={legalStatus.tone === 'good' ? 'check' : 'alert'}>
                {legalStatus.word}
              </Badge>
            </span>
            <KpiValue>{legalStatus.value}</KpiValue>
            <KpiSub>
              {legal.overdue
                ? legal.dueSoon
                  ? `${legal.dueSoon} more due in the next ${LEGAL_WINDOW_DAYS} days`
                  : `Nothing else due in the next ${LEGAL_WINDOW_DAYS} days`
                : legal.dueSoon
                  ? `Due in the next ${LEGAL_WINDOW_DAYS} days`
                  : `Nothing due in the next ${LEGAL_WINDOW_DAYS} days`}
            </KpiSub>
          </KpiTile>

          <KpiTile label="People cost / month" target={SECTION.cost} jumpLabel="Go to people cost and runway">
            <KpiValue>
              <Money value={cost.now.monthly} short />
            </KpiValue>
            <KpiSub>
              Fully loaded.
              {cost.withOffers.monthly !== cost.now.monthly && (
                <>
                  {' '}
                  <Money value={cost.withOffers.monthly} short /> once {startNames} start.
                </>
              )}
              {cost.now.contractorsMonthly > 0 && (
                <>
                  {' '}
                  Contractors <Money value={cost.now.contractorsMonthly} short />.
                </>
              )}
            </KpiSub>
          </KpiTile>

          <KpiTile label="Headcount" target={SECTION.headcount} jumpLabel="Go to headcount vs plan">
            <span className="mt-1.5 flex w-full flex-wrap items-end justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <span className="ft-stat__value num font-display text-[28px] leading-none font-bold text-ink">{head.current}</span>
                {head.plan && (
                  <span className="num text-[13px] text-ink-2">
                    / plan {head.plan.value} by {fmtShort(head.plan.date)}
                  </span>
                )}
              </span>
              <Sparkline
                values={head.history}
                reference={head.next?.n}
                ariaLabel={`Headcount history from ${head.history[0] ?? 0} to ${head.current}${head.next ? `, next threshold ${head.next.n}` : ''}`}
              />
            </span>
            <KpiSub>
              {head.next
                ? head.next.away === 0
                  ? `At ${head.next.n}: new rules apply`
                  : `${plural(head.next.away, 'hire')} to ${head.next.n}, the next legal threshold`
                : 'Past the thresholds this app tracks'}
            </KpiSub>
          </KpiTile>

          <KpiTile label="Runway" target={SECTION.cost} jumpLabel="Go to people cost and runway">
            <KpiValue>{runwayNow == null ? 'Not set' : runwayMonthsLabel(runwayNow)}</KpiValue>
            <KpiSub>
              {runwayNow == null
                ? 'Add cash on hand in Settings'
                : runwayPlan != null && cost.atPlan.monthly !== cost.now.monthly
                  ? `${runwayMonthsLabel(runwayPlan)} if the hiring plan lands`
                  : "At today's burn"}
            </KpiSub>
          </KpiTile>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 @[900px]:grid-cols-2">
          <Target id={SECTION.legal}>
            <Panel
              title="Legal exposure"
              subtitle={`Overdue first, then due in the next ${LEGAL_WINDOW_DAYS} days. Every change can be undone.`}
              icon="scale"
              actions={<SectionLink href={links.compliance()}>Full compliance list</SectionLink>}
            >
              {legal.rows.length === 0 ? (
                <EmptyState compact icon="check" title="No legal items due" body={`Nothing is overdue or due in the next ${LEGAL_WINDOW_DAYS} days.`} />
              ) : (
                <ActionList rows={legal.rows.map(legalRowData)} viewer={viewer} cap={8} />
              )}
              <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-3">{NOT_LEGAL_ADVICE}</p>
            </Panel>
          </Target>

          <Target id={SECTION.approvals}>
            <Panel title="Approvals" subtitle="Decisions only you can make, with what each one costs or when it lands." icon="check">
              {approvals.length === 0 ? (
                <EmptyState compact icon="check" title="Nothing to approve" body="Offers, pay runs, grants and time off show here when they need your decision." />
              ) : (
                <ActionList rows={approvals.map(approvalRowData)} viewer={viewer} />
              )}
              {others > 0 && (
                <div className="mt-3 border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={openOthers}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[14px] font-semibold text-accent hover:underline"
                  >
                    {plural(others, 'item')} waiting on others
                    <Icon name="arrow-right" size={15} />
                  </button>
                </div>
              )}
            </Panel>
          </Target>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 @[900px]:grid-cols-2">
          <Target id={SECTION.cost}>
            <CostRunwayPanel cost={cost} />
          </Target>
          <Target id={SECTION.headcount}>
            <GrowthPanel />
          </Target>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 @[900px]:grid-cols-2">
          <Panel title="Hiring" subtitle={`${plural(hiring.length, 'open job')}, longest open first`} icon="briefcase" actions={<SectionLink href={links.hiring()}>Open hiring</SectionLink>}>
            <DataTable
              rows={hiring}
              columns={HIRING_COLUMNS}
              rowKey={(r) => r.jobId}
              rowHref={(r) => links.job(r.jobId)}
              dense
              caption="Open jobs"
              empty={<EmptyState compact icon="briefcase" title="No open jobs" body="Open a job from the plan or a role template when you are ready to hire." />}
            />
          </Panel>
          <Panel title="Joining and leaving" subtitle="Onboarding and offboarding in flight" icon="clipboard-check" actions={<SectionLink href={links.people('checklists')}>All checklists</SectionLink>}>
            <DataTable
              rows={moves}
              columns={MOVE_COLUMNS}
              rowKey={(r) => r.key}
              rowHref={(r) => (r.checklistId ? links.checklist(r.checklistId) : links.person(r.personId))}
              dense
              caption="People joining and leaving"
              empty={<EmptyState compact icon="clipboard-check" title="Nothing in flight" body="Hiring someone starts their onboarding checklist with every California date worked out." />}
            />
          </Panel>
        </div>

        <Target id={SECTION.inbox}>
          <Panel
            title="Full inbox"
            subtitle={`Everything computed from your data, ${plural(items.length, 'item')}, including what waits on others.`}
            icon="inbox"
            padded={inboxOpen}
            actions={<FoldButton name="the full inbox" open={inboxOpen} onToggle={() => setInboxOpen((v) => !v)} />}
          >
            {inboxOpen ? <InboxView items={items} date={date} viewer={viewer} /> : null}
          </Panel>
        </Target>
        {weekOpen ? (
          <ThisWeekPanel viewer={viewer} actions={<FoldButton name="this week" open onToggle={() => setWeekOpen(false)} />} />
        ) : (
          <Panel
            title="This week"
            subtitle="Who's out, starts, interviews and deadlines for the next 7 days."
            icon="calendar"
            padded={false}
            actions={<FoldButton name="this week" open={false} onToggle={() => setWeekOpen(true)} />}
          >
            {null}
          </Panel>
        )}
      </div>
    </>
  )
}
