import { useCallback, useEffect, useState } from "react";
import { CircleHelp, Menu, Share2, X, Settings2 } from "lucide-react";
import ProductOverview from "../components/views/ProductOverview";
import Wizard from "../components/wizard/Wizard";
import ProductFacts from "../components/views/ProductFacts";
import Opportunities from "../components/views/Opportunities";
import Campaigns from "../components/views/Campaigns";
import ProductMetrics from "../components/views/ProductMetrics";
import Content from "../components/views/Content";
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
import SocialNavEntry from "../components/SocialNavEntry";
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
import { useT } from "../lib/i18n";
import { NAV } from "../lib/edition";
import type { Ctx, View } from "../components/views/types";

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
  const allowed: View[] = [
    "overview",
    "reports",
    "company",
    "opportunities",
    "campaigns",
    "metrics",
    "content",
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
    setParams({ view: v, ...extra });
    setMobile(false);
  };
  const setParam = (k: string, v: string) =>
    setParams((p) => ({ ...p, [k]: v }));
  const openWizard = async (step?: string) => {
    try {
      checklist.setData(await runLocal<ChecklistData>("today.openWizard", {}));
      setWizardStep(step || null); setWizardOpen(true);
    } catch (e) { checklist.setError((e as Error).message); }
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
    if (view === "opportunities") return <Opportunities ctx={ctx} />;
    if (view === "campaigns")
      return <Campaigns ctx={ctx} params={params} setParam={setParam} />;
    if (view === "metrics")
      return <ProductMetrics ctx={ctx} params={params} setParam={setParam} />;
    if (view === "content")
      return <Content ctx={ctx} params={params} setParam={setParam} />;
    if (view === "calendar")
      return <Calendar ctx={ctx} params={params} setParam={setParam} />;
    if (view === "assets")
      return <Assets ctx={ctx} params={params} setParam={setParam} />;
    if (view === "reports")
      return <Reports ctx={ctx} params={params} setParam={setParam} />;
    if (view === "social")
      return <Social ctx={ctx} params={params} setParam={setParam} />;
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
    return <ProductOverview ctx={ctx} />;
  };
  const navClass = (active: boolean) =>
    cx(
      "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
    );
  const wizard = checklist.data?.wizard;
  if (ready && profile !== undefined && !needLogin && wizard && !wizard.closed && (wizardOpen || wizard.current))
    return <Wizard ctx={ctx} initialStep={wizardStep} onExit={() => {
      setWizardStep(null); setWizardOpen(false); setSetupOpen(true);
      reloadProfile(); reloadChannels(); go("overview");
    }} />;
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
        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {NAV.map((group, i) => (
            <div key={group.group || i}>
              {group.presentation === "social" ? (
                <SocialNavEntry
                  channels={channels}
                  active={view === "social"}
                  onClick={() => go("social")}
                />
              ) : (
                <>
                  <p className="mb-2 px-3 text-xs text-muted-foreground">
                    {t(group.group || "g_work")}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((n) => (
                      <button
                        key={n.view}
                        aria-current={view === n.view ? "page" : undefined}
                        className={navClass(view === n.view)}
                        title={t(n.view + "_sub")}
                        onClick={() => go(n.view)}
                      >
                        <n.icon className="size-4 shrink-0" />
                        <span>{t(n.view)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
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
