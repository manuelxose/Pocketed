import {
  Activity, AlertTriangle, BarChart3, BookOpen, Briefcase, CheckCircle2,
  Code2, ExternalLink, Eye, FlaskConical, Gift, KeyRound, Layers, Sparkles,
  Shield, ShieldAlert, Target, Twitter, Wallet, Zap,
} from 'lucide-react';
import { Card, Page, Section } from '../components/common';
import { POLYMARKET_REFERRAL_URL } from '../utils/links';
import { followYuhgo, X_PROFILE } from '../utils/share';

export function GuidePage() {
  const open = (url: string) => () => window.open(url, '_blank', 'noopener,noreferrer');

  return (
    <Page
      title="Guide"
      subtitle="How Pocketed works, what each setting does, and the trading edge it tries to capture."
    >
      <Card className="mb-6 border-pocketed-purple/30 bg-gradient-to-br from-pocketed-purple/15 via-pocketed-glow/20 to-transparent">
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-pocketed-glow shadow-pocketed-strong">
            <Gift className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">
              New to Polymarket? Get up to $50 in trading credits.
            </div>
            <p className="mt-1 text-xs text-pocketed-muted">
              Sign up via our referral link, then deposit $20 and place
              your first trade — Polymarket&apos;s current offer is up to $50 in trading
              credits for new users (trading credit, not instant cash; terms set by
              Polymarket). Do it before connecting your wallet to maximize your
              starting bankroll.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={open(POLYMARKET_REFERRAL_URL)} className="pocketed-btn-primary">
              <Gift className="h-4 w-4" /> Sign up on Polymarket <ExternalLink className="h-3 w-3" />
            </button>
            <button
              onClick={() => void followYuhgo()}
              className="pocketed-btn-default"
              title={`Open ${X_PROFILE} on X`}
            >
              <Twitter className="h-4 w-4" /> Follow {X_PROFILE} <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </Card>

      <Section title="At a glance">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            icon={Eye}
            title="Two scanners"
            body="Whale tracker watches large taker fills (smart-money-style flow). Momentum tracker hunts price/volume divergences across active markets."
          />
          <FeatureCard
            icon={Target}
            title="Edge-based sizing"
            body="Position size scales linearly with the gap between signal confidence and the market's implied probability. Bigger edge → bigger bet, capped by your hard limits."
          />
          <FeatureCard
            icon={Layers}
            title="Risk gates everywhere"
            body="Per-market dedupe, per-event dedupe, max open positions, max daily new positions, exposure ceiling, daily stop-loss, and minimum cash reserve."
          />
        </div>
      </Section>

      <Section title="Setup in 5 minutes">
        <Card>
          <ol className="space-y-4 text-sm">
            <Step
              n={1}
              title="Fund a Polygon wallet with USDC"
              body={
                <>
                  Sign up via the link above (deposit $20 and place a first trade for up to
                  $50 in trading credits from Polymarket), then make sure your
                  Polygon wallet holds USDC (and a little MATIC for the one-time token
                  approvals). Use a <span className="text-white">dedicated trading
                  wallet</span> — only fund it with what you intend to trade.
                </>
              }
            />
            <Step
              n={2}
              title="Export that wallet's private key"
              body={
                <>
                  In your wallet (e.g. MetaMask →{' '}
                  <span className="text-white">Account details → Show private key</span>)
                  copy the 64-character hex key for the account holding your USDC.
                </>
              }
            />
            <Step
              n={3}
              title="Connect it on the Wallet page"
              body={
                <>
                  Click <Wallet className="inline h-3.5 w-3.5" /> Wallet in the sidebar,
                  paste the private key, hit <span className="text-white">Save &amp;
                  connect</span>. The bot derives your Polymarket CLOB API credentials,
                  signs orders locally, and starts streaming your balance.
                </>
              }
            />
            <Step
              n={4}
              title="Pick a strategy preset"
              body={
                <>
                  <Sparkles className="inline h-3.5 w-3.5" /> Main Engine offers
                  Conservative, Balanced, and High-Risk presets. They tweak edge
                  thresholds, position sizing, and which scanners are enabled —
                  every knob is tunable right below the presets on the same page.
                  You can also clone one into <Briefcase className="inline h-3.5 w-3.5" /> Profiles.
                </>
              }
            />
            <Step
              n={5}
              title="Start small, then scale"
              body={
                <>
                  There's no paper mode — pressing{' '}
                  <span className="text-white">Start this engine</span> on the{' '}
                  <span className="text-white">Main Engine</span> page sends real orders.
                  Begin with a small balance and low caps, watch a few scan cycles, then
                  scale up. The Pause button on that same page is its kill-switch. Every
                  engine has its own switch on its own page — none of them starts another.
                </>
              }
            />
          </ol>
        </Card>
      </Section>

      <Section title="Test safely before risking real money">
        <Card className="border-pocketed-win/25 bg-pocketed-win/[0.03]">
          <div className="mb-4 flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pocketed-win/15 text-pocketed-win">
              <Shield className="h-5 w-5" />
            </div>
            <p className="text-sm text-pocketed-muted">
              Polymarket is <span className="text-white">mainnet-only, real USDC</span> — there's no
              play-money exchange. So test the bot without risking funds in one of these ways:
            </p>
          </div>
          <ol className="space-y-4 text-sm">
            <Step n={1} title="The Simulation build (no wallet, no risk)" body={
              <>The bundled <span className="text-white">Simulation</span> app runs a fully fake,
                self-contained market so you can explore every page and watch trades play out with
                zero setup and no wallet at all — the safest sandbox to learn the UI before risking a cent.
              </>
            } />
            <Step n={2} title="A tiny dedicated wallet" body={
              <>For a real-money smoke test, fund a{' '}
                <span className="text-white">separate</span> wallet with a small amount of USDC you can
                afford to lose, set a low <span className="text-white">hard max position</span> + daily
                stop-loss, then press <span className="text-white">Start this engine</span> on the{' '}
                <span className="text-white">Main Engine</span> page. Judge results on
                the <span className="text-white">History</span> page before scaling up.
              </>
            } />
          </ol>
          <div className="mt-3 text-[11px] text-pocketed-dim">
            Never paste a private key for a wallet holding funds you can't afford to lose. The bot's
            strategies are heuristics with no proven edge.
          </div>
        </Card>
      </Section>

      <Section title="How a trade flows">
        <Card>
          <FlowDiagram />
          <div className="mt-4 grid gap-3 text-xs text-pocketed-muted md:grid-cols-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white">
                1. Scan
              </div>
              Whale tracker hits Polymarket every {`~`}2 min looking for taker fills above
              your dollar threshold. Momentum tracker scans markets every {`~`}90s for
              moves that match your signal types. Both write rows into the local DB.
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white">
                2. Filter &amp; size
              </div>
              Trader checks confidence, edge, allowed categories, dedup, exposure
              caps, and daily risk gates. If a candidate passes, sizing maps the
              edge in pts to a $ stake between your min and max fractions.
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white">
                3. Place &amp; track
              </div>
              Order goes in as a limit cross (or mid, depending on order style).
              Polled every 30s for fill status. On settlement, the resolver reads
              the market's binary outcome and writes the final P&amp;L.
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Setting cheat sheet">
        <Card>
          <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            <SettingRow
              label="min_confidence_*"
              hint="The signal's quality score (0–100). Higher = more selective. Conservative ≈ 78, Balanced ≈ 70, High-Risk ≈ 60."
            />
            <SettingRow
              label="min_edge_pts_*"
              hint="Required gap between confidence and the market's implied probability. 5 pts = a small edge, 12+ pts = strong."
            />
            <SettingRow
              label="min/max_size_fraction"
              hint="Fraction of bankroll bet at minimum / maximum edge. Sizing interpolates between them. Cap with hard_max_position_usd."
            />
            <SettingRow
              label="max_open_positions"
              hint="Hard ceiling on simultaneous unsettled bets. Protects against signal storms."
            />
            <SettingRow
              label="max_total_exposure_fraction"
              hint="At-risk capital cannot exceed this fraction of bankroll. Shrinks new bets when full."
            />
            <SettingRow
              label="stop_loss_on_day"
              hint="Negative dollar amount. If today's realized P&L hits this, no new entries until tomorrow."
            />
            <SettingRow
              label="take_profit_on_day"
              hint="Positive dollar amount. Same idea — locks in a profitable day."
            />
            <SettingRow
              label="order_style"
              hint="limit_cross (aggressive: cross spread to fill fast), limit_mid (cheaper, may not fill), or market."
            />
            <SettingRow
              label="allowed_categories"
              hint="Toggle market categories on/off (Sports, Politics, Crypto, etc.). Empty = trade nothing."
            />
            <SettingRow
              label="min_cash_reserve_fraction"
              hint="Always keep at least this fraction of bankroll in cash. Prevents over-leveraging."
            />
          </div>
        </Card>
      </Section>

      <Section title="Reading the dashboard">
        <Card>
          <ul className="space-y-2 text-sm text-pocketed-muted">
            <Row
              icon={BarChart3}
              label="Total Balance"
              body="Cash + portfolio (live mark-to-market). Updated from Polymarket every snapshot."
            />
            <Row
              icon={Target}
              label="ROI"
              body="(Total - bankroll baseline) / baseline. Baseline is your manual start_bankroll_usd, or auto-detected from your first snapshot."
            />
            <Row
              icon={CheckCircle2}
              label="Today P&L"
              body="Sum of realized P&L on positions resolved today (rolls over at midnight). Does not include unrealized swing on still-open bets."
            />
            <Row
              icon={Briefcase}
              label="Open Positions"
              body="Count of filled / partial bets that haven't settled yet. The cap is max_open_positions."
            />
            <Row
              icon={Activity}
              label="Recent resolutions"
              body="The latest settled bets with their P&L. Pair this with the Positions page's Won / Lost tabs to see the whole story."
            />
          </ul>
        </Card>
      </Section>

      <Section title="When P&amp;L looks weird">
        <Card>
          <div className="mb-3 flex items-start gap-3 rounded-lg border border-pocketed-warn/30 bg-pocketed-warn/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-pocketed-warn" />
            <div className="text-xs text-pocketed-muted">
              <span className="text-white">Today P&L can be negative while your balance climbs.</span>
              {' '}Realized P&L only counts <span className="text-white">settled</span> bets.
              If your open positions are appreciating, your total balance goes up
              even though "Today P&L" reflects only the bets that already
              resolved. That's normal — wait for settlement.
            </div>
          </div>
          <div className="text-sm text-pocketed-muted">
            If something looks broken (wrong wins/losses, stuck positions, etc.):
          </div>
          <ul className="mt-2 space-y-1.5 text-sm text-pocketed-muted">
            <li>
              <span className="text-white">Positions → Reconcile</span> — re-syncs
              local rows with Polymarket's live position list.
            </li>
            <li>
              <span className="text-white">Positions → Resolve Now</span> — forces
              one resolution pass for any settled markets.
            </li>
            <li>
              <span className="text-white">Positions → Recompute P&amp;L</span> —
              wipes locally-stored P&L for resolved trades and rebuilds from each
              market's settlement value. Use after upgrading or if the dashboard
              shows obviously wrong wins/losses.
            </li>
            <li>
              <span className="text-white">Restart</span> button (top bar) — bounces
              the Python backend if it's stuck.
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="Strategy intuition">
        <Card>
          <div className="grid gap-4 md:grid-cols-3">
            <StratBlock
              icon={Zap}
              tone="loss"
              title="High Risk"
              body="Lower confidence floor (~60), wider edge tolerance, higher max size fraction. Lots of fills, lots of swings, biggest variance. Best for finding what works fast — on a small balance."
            />
            <StratBlock
              icon={Activity}
              tone="purple"
              title="Balanced"
              body="Default. Confidence ~70, edge ≥ 5pts, sizing 1.5–6% of bankroll. Mix of whale and momentum signals. Reasonable variance, plenty of trades to evaluate."
            />
            <StratBlock
              icon={CheckCircle2}
              tone="win"
              title="Conservative"
              body="Confidence ≥ 78, edge ≥ 8pts, smaller sizing, tight per-event dedupe. Fewer trades but higher hit-rate. Best when you want to ride out long stretches."
            />
          </div>
          <div className="mt-4 text-xs text-pocketed-dim">
            All three are starting points — clone any of them into a Profile and
            adjust. Track outcomes via the History page over a few days before you
            commit real capital.
          </div>
        </Card>
      </Section>

      <Section title="Writing your own strategy (Scripts)">
        <Card>
          <p className="text-sm text-pocketed-muted">
            The <span className="text-white">Scripts</span> page runs your own Python strategy
            alongside the built-in engines. You write one or more hooks, backtest them against the
            ticks this app has already recorded, then arm the script to trade under caps you set.
            Scripts are <span className="text-white">fully independent</span> — none of the other
            engines has to be switched on, each script picks its own coins, and the whale/momentum
            collector is kept running automatically for any script that reads signals.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <FeatureCard
              icon={Code2}
              title="decide(ctx)"
              body="Called once per coin per tick while a crypto Up/Down window is open. Return None to pass, or an intent like {'side': 'up', 'price': 'ask'} to buy a side."
            />
            <FeatureCard
              icon={BarChart3}
              title="decide_market(market)"
              body="Called each tick for the highest-volume general Polymarket markets — politics, sports, news. You get the title, category, both sides of the book, spread and volume, and return an intent sized in contracts or dollars."
            />
            <FeatureCard
              icon={Activity}
              title="manage(position, ctx)"
              body="Called every tick for each open position. Return 'sell' to flatten at the bid now, or retune take-profit / stop-loss — this is how you build trailing stops."
            />
            <FeatureCard
              icon={Target}
              title="decide_signal(signal)"
              body="Called for each new whale / momentum signal. You filter and size which ones to follow; follows buy the signal's own side."
            />
            <FeatureCard
              icon={Layers}
              title="supervise(app)"
              body="Called once per tick to change whitelisted config — switch strategy posture, or turn an engine off when conditions sour. Scripts may disable engines, never enable them."
            />
          </div>

          <div className="mt-4 text-xs text-pocketed-muted">
            <span className="text-white">ctx</span> carries around 40 fields per tick: real order-book
            asks and bids, the underlying's spot price and realized volatility, MACD / RSI / VWAP /
            EMA / SMA, the model's probability and fee-net edge, minutes left in the window, and your
            own portfolio (balance, open positions, today's P&amp;L). Keep memory between ticks in the
            persistent <span className="text-white">state</span> dict, and use{' '}
            <span className="text-white">on_start</span> /{' '}
            <span className="text-white">on_fill</span> /{' '}
            <span className="text-white">on_settle</span> for lifecycle events. The page's{' '}
            <span className="text-white">AI context pack</span> button copies a single prompt
            containing the whole field vocabulary, the return contract, and your actual rails — paste
            it into any assistant to have it write the script for you.
          </div>
        </Card>

        <Card className="mt-4">
          <ul className="space-y-2">
            <Row
              icon={Shield}
              label="Hard rails"
              body="Max entry price, max contracts per order, max open positions per script, a per-script daily-loss breaker that auto-disables on a bad day, and one entry attempt per market window. These apply to every script — a script can never place an order larger than your cap."
            />
            <Row
              icon={Eye}
              label="Shadow first"
              body="Every new script starts in shadow mode: it runs on live ticks and records the orders it would have placed, settled from the real outcome with fees charged, without sending anything to the exchange. Arming it for real orders is a separate, confirmed step. Shadow simulates entries only — exits are held to settlement."
            />
            <Row
              icon={FlaskConical}
              label="Backtest first"
              body="Backtest over your recorded windows before arming. The report ships its own caveats: resting limits aren't modeled as maker fills, exit fills are optimistic (these markets often have no bid at all), and the rails aren't simulated — so live is a subset of what you see."
            />
            <Row
              icon={AlertTriangle}
              label="Errors fail closed"
              body="Any exception, malformed return, or hook that overruns its time limit disables that script and shows you why. A broken script never takes the rest of the app down with it."
            />
            <Row
              icon={Activity}
              label="It tells you when it isn't running"
              body="Each script shows its real state — running, blocked, starting, error — with the reason. 'Enabled' alone was never the answer: a script can be enabled and doing nothing because the wallet is disconnected, or because it is armed while the master switch is off. The status line names the gate."
            />
          </ul>
        </Card>

        <Card className="mt-4 border-pocketed-loss/30 bg-pocketed-loss/5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-pocketed-loss" />
            <div className="text-xs leading-relaxed text-pocketed-muted">
              <div className="text-sm font-medium text-white">Read any script you did not write</div>
              <p className="mt-1">
                Scripts run as <span className="text-white">full Python</span>, with the same
                privileges as the trading engine, in the process that holds your decrypted wallet
                key. There is no language sandbox — the old one blocked imports and most of the
                standard library, which fought every real strategy while never being a genuine
                security boundary.
              </p>
              <p className="mt-2">
                Instead the app <span className="text-white">audits</span> every script and shows
                you what it found: network access, filesystem writes, subprocesses, environment or
                credential-shaped names, and dynamic execution. Obfuscation is itself reported as
                critical, because a static scan cannot see through it. The findings are on the
                script's <span className="text-white">Risk</span> tab, and a flagged script says so
                again when you go to arm it.
              </p>
              <p className="mt-2">
                Treat that as a smoke detector, <span className="text-white">not a lock</span>. Read
                anything an AI generated or another person sent you before enabling it. The money
                rails above still apply to every script and cannot be raised from inside one.
              </p>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Tips">
        <Card>
          <ul className="space-y-2 text-sm text-pocketed-muted">
            <li>
              <BookOpen className="mr-2 inline h-3.5 w-3.5" />
              Run the bot on a small balance for at least a few hundred resolved signals
              before going live. The Profiles page lets you A/B test settings.
            </li>
            <li>
              <BookOpen className="mr-2 inline h-3.5 w-3.5" />
              Tighten <span className="text-white">allowed_categories</span> if you
              don't trust certain markets (e.g., low-liquidity regional sports).
            </li>
            <li>
              <BookOpen className="mr-2 inline h-3.5 w-3.5" />
              Use <span className="text-white">order_expiration_sec</span> to cancel
              resting orders that haven't filled. Stale fills at bad prices kill edge.
            </li>
            <li>
              <BookOpen className="mr-2 inline h-3.5 w-3.5" />
              The History page's Daily P&L chart is the truest signal of whether
              your config has edge. Don't judge from a single trade.
            </li>
          </ul>
        </Card>
      </Section>
    </Page>
  );
}

function FeatureCard({
  icon: Icon, title, body,
}: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-pocketed-purple/15 text-pocketed-purple">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm font-semibold text-white">{title}</div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-pocketed-muted">{body}</p>
    </Card>
  );
}

function Step({
  n, title, body,
}: { n: number; title: string; body: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-pocketed-purple/40 bg-pocketed-purple/10 text-xs font-semibold text-pocketed-purple">
        {n}
      </div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-pocketed-muted">{body}</p>
      </div>
    </li>
  );
}

function SettingRow({ label, hint }: { label: string; hint: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] text-pocketed-purple">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-pocketed-muted">{hint}</div>
    </div>
  );
}

function Row({
  icon: Icon, label, body,
}: { icon: React.ComponentType<{ className?: string }>; label: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-pocketed-purple" />
      <div className="text-xs">
        <span className="text-white">{label}</span>
        <span className="ml-2 text-pocketed-muted">{body}</span>
      </div>
    </li>
  );
}

function StratBlock({
  icon: Icon, tone, title, body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'win' | 'loss' | 'purple';
  title: string;
  body: string;
}) {
  const toneClasses = {
    win: 'border-pocketed-win/30 bg-pocketed-win/5 text-pocketed-win',
    loss: 'border-pocketed-loss/30 bg-pocketed-loss/5 text-pocketed-loss',
    purple: 'border-pocketed-purple/30 bg-pocketed-purple/5 text-pocketed-purple',
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-pocketed-muted">{body}</p>
    </div>
  );
}

function FlowDiagram() {
  return (
    <svg viewBox="0 0 720 130" className="w-full text-pocketed-muted">
      {[
        { x: 20, label: 'Polymarket API', sub: 'markets · fills' },
        { x: 175, label: 'Scanner', sub: 'whale + momentum' },
        { x: 330, label: 'Trader', sub: 'filter · size · place' },
        { x: 485, label: 'Order book', sub: 'limit cross' },
        { x: 620, label: 'Resolver', sub: 'settlement P&L' },
      ].map((n, i) => (
        <g key={i}>
          <rect
            x={n.x} y={35} width={90} height={60} rx={10}
            className="fill-pocketed-surface2 stroke-pocketed-border" strokeWidth={1}
          />
          <text x={n.x + 45} y={62} textAnchor="middle" className="fill-white text-[11px] font-semibold">
            {n.label}
          </text>
          <text x={n.x + 45} y={78} textAnchor="middle" className="fill-pocketed-muted text-[10px]">
            {n.sub}
          </text>
        </g>
      ))}
      {[110, 265, 420, 575].map((x, i) => (
        <g key={i}>
          <line x1={x} y1={65} x2={x + 65} y2={65} stroke="currentColor" strokeWidth={1.5} markerEnd="url(#arrow)" />
        </g>
      ))}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>
    </svg>
  );
}
