import { useCallback, useEffect, useState } from "react";
import { ChevronDown, CircleHelp, Menu, Share2, X, Settings2 } from "lucide-react";
import ProductOverview from "../components/views/ProductOverview";
import Wizard from "../components/wizard/Wizard";
import ProductFacts from "../components/views/ProductFacts";
import GrowthPlanning from "../components/views/GrowthPlanning";
import { AccountStrategies, GrowthReviews, useMarketing } from "../components/MarketingWorkspace";
import Campaigns from "../components/views/Campaigns";
import ProductMetrics from "../components/views/ProductMetrics";
import ProductContent from "../components/views/ProductContent";
import InspirationLibrary from "../components/InspirationLibrary";
import Calendar from "../components/views/Calendar";
import Assets from "../components/views/Assets";
import Reports from "../components/views/Reports";
import Social from "../components/views/Social";
import Channels from "../components/views/Channels";
import Search from "../components/views/Search";
import Audit from "../components/views/Audit";
import Geo from "../components/views/Geo";
import SiteVisits from "../components/views/SiteVisits";
import Help from "../components/views/Help";
import Assistant from "../components/views/Assistant";
import PublishProgress from "../components/PublishProgress";
import { Button, Notice, Skeleton, cx } from "../components/ui";
import { g } from "../components/ProductFields";
import {
  loadProfile,
  listChannels,
  openShuttle,
  memberLoginURL,
  MemberLoginRequired,
  runLocal,
  type Profile,
  type Channel,
} from "../lib/shuttle";
import { useChecklist, type ChecklistData } from "../lib/useChecklist";
import { useInShuttle } from "../lib/useShuttle";
import { tr, useT } from "../lib/i18n";
import { NAV } from "../lib/edition";
import type { Ctx, View } from "../components/views/types";

const NAV_COLLAPSED = "annulo:product-nav-collapsed";
const read = () =>
  typeof window === "undefined"
    ? {}
    : Object.fromEntries(new URLSearchParams(window.location.search));
export default function Index() {
  const { t } = useT("nav"),
    shuttle = useInShuttle();
  const [params, setParams] = useState<Record<string, string>>({}),
    [ready, setReady] = useState(false),
    [mobile, setMobile] = useState(false);
  const [profile, setProfile] = useState<Profile | null | undefined>(),
    [channels, setChannels] = useState<Channel[]>([]),
    [rev, setRev] = useState(0),
    [error, setError] = useState(""),
    [needLogin, setNeedLogin] = useState(false),
    [plugin, setPlugin] = useState(true),
    [setupOpen, setSetupOpen] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false),
    [wizardStep, setWizardStep] = useState<string | null>(null);
  const handleError = useCallback((e: Error) => {
    if (e instanceof MemberLoginRequired) setNeedLogin(true);
    else setError(e.message);
  }, []);
  const reloadProfile = useCallback(() => {
    loadProfile()
      .then((p) => {
        setProfile(p);
        setNeedLogin(false);
      })
      .catch(handleError);
  }, [handleError]);
  const reloadChannels = useCallback(() => {
    listChannels()
      .then((r) => {
        setChannels(r.list);
        setPlugin(r.plugin);
      })
      .catch(handleError);
  }, [handleError]);
  useEffect(() => {
    setParams(read());
    setReady(true);
    const f = () => setParams(read());
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  useEffect(() => {
    if (!ready || !/^https?:/.test(window.location.protocol)) return;
    const u = new URL(window.location.href);
    u.search = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v),
    ).toString();
    if (u.href !== window.location.href) window.history.pushState(null, "", u);
  }, [params, ready]);
  useEffect(() => {
    reloadProfile();
    reloadChannels();
  }, [reloadProfile, reloadChannels]);
  useEffect(() => {
    const f = () => {
      reloadProfile();
      reloadChannels();
      setRev((v) => v + 1);
    };
    const message = (e: MessageEvent) => {
      if (
        e.origin === window.location.origin &&
        e.data?.type === "shuttle:refresh"
      )
        f();
    };
    window.addEventListener("message", message);
    window.addEventListener("db:changed", f);
    return () => {
      window.removeEventListener("message", message);
      window.removeEventListener("db:changed", f);
    };
  }, [reloadProfile, reloadChannels]);
  useEffect(() => {
    if (plugin) return;
    const timer = window.setInterval(reloadChannels, 5000);
    return () => clearInterval(timer);
  }, [plugin, reloadChannels]);
  const checklist = useChecklist(rev);
  // 侧栏收起的分组只记在这台电脑的浏览器里；读不到就全部展开
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(NAV_COLLAPSED) || "[]");
      if (Array.isArray(saved))
        setCollapsed(saved.filter((group): group is string => typeof group === "string"));
    } catch {}
  }, []);
  const toggleGroup = (group: string) =>
    setCollapsed((c) => {
      const next = c.includes(group) ? c.filter((x) => x !== group) : [...c, group];
      try {
        localStorage.setItem(NAV_COLLAPSED, JSON.stringify(next));
      } catch {}
      return next;
    });
  const allowed: View[] = [
    "overview",
    "reports",
    "company",
    "opportunities",
    "campaigns",
    "metrics",
    "content",
    "website-content",
    "social-content",
    "inspiration",
    "social-metrics",
    "calendar",
    "assets",
    "search",
    "geo",
    "audit",
    "social",
    "channels",
    "site",
    "help",
    "assistant",
    "settings",
  ];
  const view = allowed.includes(params.view as View)
    ? (params.view as View)
    : "overview";
  const go = (v: View, extra: Record<string, string> = {}) => {
    if (v === "content") {
      if (extra.tab === "inspiration") v = "inspiration";
      else {
        const website = extra.workspace === "website" || ["website-content", "opportunities", "search", "geo", "audit", "site", "metrics"].includes(view);
        if (website) v = "website-content";
        else if (extra.workspace === "social" || ["social", "social-content", "inspiration", "social-metrics", "calendar"].includes(view)) v = "social-content";
      }
    }
    setParams({ view: v, ...extra });
    setMobile(false);
  };
  const setParam = (k: string, v: string) =>
    setParams((p) => ({ ...p, [k]: v }));
  const openWizard = async (step?: string) => {
    try {
      checklist.setData(await runLocal<ChecklistData>("today.openWizard", {}));
      setWizardStep(step || null);
      setWizardOpen(true);
    } catch (e) {
      checklist.setError((e as Error).message);
    }
  };
  useEffect(() => {
    document.title = t(view);
  }, [view, t]);
  const ctx: Ctx = {
    profile: profile || { name: "" },
    channels,
    stats: null,
    days: 30,
    go,
    reloadChannels,
    reloadProfile,
    rev,
    checklist,
    setupOpen,
    toggleSetup: () => setSetupOpen((v) => !v),
    goFromSetup: go,
    openWizard,
  };
  const render = () => {
    if (view === "company" || view === "settings")
      return <ProductFacts ctx={ctx} params={params} setParam={setParam} />;
    if (view === "opportunities")
      return <GrowthPlanning ctx={ctx} params={params} setParam={setParam} />;
    if (view === "campaigns")
      return <Campaigns ctx={ctx} params={params} setParam={setParam} />;
    if (view === "metrics")
      return <ProductMetrics ctx={ctx} params={params} setParam={setParam} />;
    if (view === "inspiration" || (view === "content" && params.tab === "inspiration"))
      return <InspirationLibrary ctx={ctx} params={params} setParam={setParam} workspace="social" onChanged={() => setRev(r => r + 1)} />;
    if (["content", "website-content", "social-content"].includes(view))
      return <ProductContent key={view} ctx={ctx} params={params} setParam={setParam}
        workspace={view === "website-content" ? "website" : view === "social-content" ? "social" : undefined} />;
    if (view === "calendar")
      return <Calendar ctx={ctx} params={params} setParam={setParam} scope="social" />;
    if (view === "assets")
      return <Assets ctx={ctx} params={params} setParam={setParam} />;
    if (view === "reports")
      return <ProductOverview ctx={ctx} tab="weekly" onTab={(v) => go(v === "weekly" ? "reports" : "overview")}
        weekly={<Reports ctx={ctx} params={params} setParam={setParam} embedded />} />;
    if (view === "social")
      return <SocialAccounts ctx={ctx} params={params} setParam={setParam} />;
    if (view === "social-metrics")
      return <div className="space-y-6"><Social ctx={ctx} params={{ ...params, section: "data" }} setParam={setParam} hideTabs
        title={tr('workspace.social_reviews')} onSectionChange={(section, extra) => ctx.go(section === 'data' ? 'social-metrics' : 'social', extra)} /><GrowthReviews ctx={ctx} workspace="social" /></div>;
    if (view === "channels")
      return (
        <Channels
          ctx={ctx}
          current={params.channel || ""}
          setCurrent={(v) => setParam("channel", v)}
        />
      );
    if (view === "search")
      return <Search ctx={ctx} params={params} setParam={setParam} />;
    if (view === "audit")
      return <Audit ctx={ctx} params={params} setParam={setParam} />;
    if (view === "geo")
      return <Geo ctx={ctx} params={params} setParam={setParam} />;
    if (view === "site")
      return <SiteVisits ctx={ctx} params={params} setParam={setParam} />;
    if (view === "help")
      return <Help ctx={ctx} params={params} setParam={setParam} />;
    if (view === "assistant")
      return <Assistant ctx={ctx} params={params} setParam={setParam} />;
    return <ProductOverview ctx={ctx} tab="today" onTab={(v) => go(v === "weekly" ? "reports" : "overview")} />;
  };
  // 每周总结并进了工作台：旧的 view=reports 链接仍然能打开，侧栏高亮工作台
  const navView: View = view === "reports" ? "overview" : view;
  const groupActive = (group: (typeof NAV)[number]) =>
    group.sections.some((s) => s.items.some((n) => n.view === navView));
  const navClass = (active: boolean) =>
    cx(
      "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
    );
  const wizard = checklist.data?.wizard;
  if (
    ready &&
    profile !== undefined &&
    !needLogin &&
    wizard &&
    !wizard.closed &&
    (wizardOpen || wizard.current)
  )
    return (
      <Wizard
        ctx={ctx}
        initialStep={wizardStep}
        onExit={() => {
          setWizardStep(null);
          setWizardOpen(false);
          setSetupOpen(true);
          reloadProfile();
          reloadChannels();
          go("overview");
        }}
      />
    );
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {mobile && (
        <button
          aria-label={t("close_nav")}
          className="fixed inset-0 z-30 bg-black/35 md:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        aria-label={t("navigation")}
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[224px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:sticky md:top-0 md:flex md:h-screen",
          mobile ? "flex" : "hidden",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-5 text-sm font-semibold">
          {g("template_name")}
          <button
            aria-label={t("close_nav")}
            onClick={() => setMobile(false)}
            className="md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV.map((group, i) => {
            const items = group.sections.flatMap((s) => s.items);
            // 没有组名的是最上面的常用入口，直接列出来
            if (!group.group)
              return (
                <div key={i} className="space-y-1">
                  {items.map((n) => (
                    <button
                      key={n.view}
                      aria-current={navView === n.view ? "page" : undefined}
                      className={navClass(navView === n.view)}
                      title={t(n.view + "_sub")}
                      onClick={() => go(n.view)}
                    >
                      <n.icon className="size-4 shrink-0" />
                      <span>{t(n.view)}</span>
                    </button>
                  ))}
                </div>
              );
            const active = groupActive(group);
            const open = active || !collapsed.includes(group.group);
            const GroupIcon = group.icon;
            return (
              <div
                key={group.group}
                className={cx(
                  "rounded-lg",
                  i === NAV.length - 1 && "border-t border-sidebar-border pt-4",
                )}
              >
                <button
                  aria-expanded={open}
                  onClick={() => !active && toggleGroup(group.group!)}
                  className={cx(
                    "flex h-8 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold tracking-wide transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    !active && "cursor-pointer",
                  )}
                >
                  {GroupIcon && <GroupIcon className="size-3.5 shrink-0" />}
                  <span className="flex-1">{t(group.group)}</span>
                  {!active && (
                    <ChevronDown
                      className={cx("size-3.5 transition-transform", !open && "-rotate-90")}
                    />
                  )}
                </button>
                {open && (
                  <div className="mt-1 ml-[18px] space-y-2 border-l border-sidebar-border pl-2">
                    {group.sections.map((sec, j) => (
                      <div key={sec.section || j} className="space-y-0.5">
                        {sec.section && group.sections.length > 1 && (
                          <p className="px-3 pt-1 pb-0.5 text-[11px] text-muted-foreground/70">
                            {t(sec.section)}
                          </p>
                        )}
                        {sec.items.map((n) => (
                          <button
                            key={n.view}
                            aria-current={navView === n.view ? "page" : undefined}
                            className={cx(navClass(navView === n.view), "h-8")}
                            title={t(n.view + "_sub")}
                            onClick={() => go(n.view)}
                          >
                            <n.icon className="size-4 shrink-0" />
                            <span className="truncate">{t(n.view)}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-sidebar-border p-3">
          {(
            [
              ["channels", Share2],
              ["help", CircleHelp],
            ] as const
          ).map(([v, Icon]) => (
            <button
              key={v}
              onClick={() => go(v)}
              className={navClass(view === v)}
            >
              <Icon className="size-4" />
              {t(v)}
            </button>
          ))}
          <Button
            needsShuttle
            variant="ghost"
            className="w-full"
            onClick={() => openShuttle("settings")}
          >
            <Settings2 />
            {t("shuttle_settings")}
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 border-b border-border px-5">
          <button
            aria-label={t("open_nav")}
            onClick={() => setMobile(true)}
            className="md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-medium">{t(view)}</span>
        </header>
        <div className="mx-auto max-w-[1400px] space-y-4 p-5 lg:p-8">
          {error && (
            <Notice tone="error">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError("");
                    reloadProfile();
                    reloadChannels();
                  }}
                >
                  {g("retry")}
                </Button>
              </div>
            </Notice>
          )}
          {!plugin && <Notice>{g("plugin_missing")}</Notice>}
          {!shuttle && <Notice>{g("remote_note")}</Notice>}
          {needLogin ? (
            <Notice>
              <a
                className="text-primary-text underline"
                href={memberLoginURL()}
              >
                {t("member_login_btn")}
              </a>
            </Notice>
          ) : !ready || profile === undefined ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (
            render()
          )}
        </div>
        <PublishProgress />
      </main>
    </div>
  );
}

function SocialAccounts({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const { data, error, reload } = useMarketing(ctx);
  return <div className="space-y-6">
    <Social ctx={ctx} params={{ ...params, section: 'overview' }} setParam={setParam} hideTabs title={tr('workspace.account_position')}
      onSectionChange={(section, extra) => ctx.go(section === 'data' ? 'social-metrics' : 'social', extra)} />
    {error && <Notice tone="error">{error}</Notice>}
    <h2 className="text-lg font-semibold">{tr('workspace.account_strategies')}</h2>
    <AccountStrategies ctx={ctx} data={data} reload={reload} />
  </div>;
}
