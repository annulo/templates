import { useEffect, useRef, useState } from "react";
import { Button, Notice, Skeleton } from "../ui";
import { g, TextFields } from "../ProductFields";
import { useAIReady, useOnboarding } from "../../lib/onboarding";
import { openShuttle, runLocal } from "../../lib/shuttle";
import { tr } from "../../lib/i18n";
import type { ProductBrief } from "../../local/productstart";
import type { WizardScreen } from "./types";

const keys = ["name", "website_url", "business", "customer_types", "positioning", "advantages", "buyer_concerns", "markets", "pricing", "keywords", "brand_terms", "tone", "goal", "signup_event", "activation_event", "paid_event", "competitors", "source_url", "verified_at"];
const ProductDetails: WizardScreen = ({ ctx, onFinish, onBusyChange }) => {
  const { data, error: loadError } = useOnboarding(ctx.rev, true, "productstart");
  const [brief, setBrief] = useState<ProductBrief | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const touched = useRef(false);
  const { ready: aiReady, check: checkAI } = useAIReady();
  useEffect(() => {
    if (!data) return;
    if (touched.current) {
      if (revision !== data.revision) setError(tr("onboarding.site_changed"));
      return;
    }
    const saved = (data as typeof data & { draft?: ProductBrief }).draft;
    const values = saved?.profile || (data.company_refresh ? {} : data.profile) as unknown as Record<string, string>;
    setRevision(data.revision);
    setBrief({
      profile: Object.fromEntries(keys.map((key) => [key, values[key] || ""])),
      products: saved?.products || [], use_cases: saved?.use_cases || [],
    });
    if (!saved) setBrief((current) => current && ({ ...current, profile: { ...current.profile, website_url: data.website_url || data.channel?.preview_url || current.profile.website_url } }));
  }, [data, revision]);
  const set = (value: ProductBrief) => { touched.current = true; setBrief(value); };
  const save = async () => {
    if (!data || !brief || revision === null || busy) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try {
      await runLocal("productstart.saveDetails", { ...brief, revision });
      await runLocal("today.unskip", { key: "company-details" });
      await onFinish();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  if (!brief || !data) return loadError ? <Notice tone="error">{loadError}</Notice> : <Skeleton className="h-48 rounded-xl" />;
  return <form id="trade-onboarding-brief" className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <Notice>{tr("onboarding.reparse_review")}</Notice>
    {!aiReady && <Notice><p>{tr("onboarding.no_ai")}</p><div className="mt-2 flex gap-2"><Button variant="outline" onClick={() => openShuttle("settings", "llm")}>{tr("onboarding.no_ai_settings")}</Button><Button variant="ghost" onClick={() => void checkAI()}>{tr("common.refresh")}</Button></div></Notice>}
    {data.company_status === "failed" && <Notice tone="error">{data.company_note || tr("onboarding.extract_failed")}</Notice>}
    <TextFields value={brief.profile} onChange={(profile) => set({ ...brief, profile })} fields={[
      { key: "name" }, { key: "website_url", type: "url" },
      { key: "business", long: true }, { key: "customer_types", long: true },
      { key: "positioning", long: true }, { key: "advantages", long: true },
    ]} />
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">{tr("onboarding.more_details")}</summary><div className="mt-4"><TextFields value={brief.profile} onChange={(profile) => set({ ...brief, profile })} fields={[
      { key: "buyer_concerns", long: true }, { key: "markets" }, { key: "pricing", long: true },
      { key: "keywords", long: true }, { key: "brand_terms" }, { key: "tone" }, { key: "goal", long: true },
      { key: "signup_event" }, { key: "activation_event" }, { key: "paid_event" },
      { key: "competitors", long: true }, { key: "source_url", type: "url" }, { key: "verified_at" },
    ]} /></div></details>
    {!!brief.products.length && <section className="space-y-3"><h2 className="font-semibold">{g("tab_facts")} · {brief.products.length}</h2>{brief.products.map((item, index) => <details key={index} className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">{item.name}</summary><div className="mt-4"><TextFields value={item} fields={[
      { key: "name" }, { key: "audience" }, { key: "summary", long: true }, { key: "features", long: true }, { key: "limitations", long: true }, { key: "price" }, { key: "source_url", type: "url" },
    ]} onChange={(next) => set({ ...brief, products: brief.products.map((p, i) => i === index ? next : p), use_cases: brief.use_cases.map((c) => c.product_name === item.name ? { ...c, product_name: next.name } : c) })} /></div></details>)}</section>}
    {!!brief.use_cases.length && <section className="space-y-3"><h2 className="font-semibold">{g("tab_usecases")} · {brief.use_cases.length}</h2>{brief.use_cases.map((item, index) => <details key={index} className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">{item.title} · {item.product_name}</summary><div className="mt-4"><TextFields value={item} fields={[
      { key: "title" }, { key: "audience" }, { key: "problem", long: true }, { key: "workflow", long: true }, { key: "outcome", long: true },
    ]} onChange={(next) => set({ ...brief, use_cases: brief.use_cases.map((c, i) => i === index ? next : c) })} /></div></details>)}</section>}
    {data.company_note && <p className="text-sm text-muted-foreground">{data.company_note}</p>}
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
};
export default ProductDetails;
