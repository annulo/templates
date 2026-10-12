import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button, Dialog, Notice, PageHeader, Panel } from "../ui";
import WorkspaceTabs from "../WorkspaceTabs";
import {
  Choice,
  DataState,
  Empty,
  g,
  TaskTools,
  TextFields,
  useProductData,
} from "../ProductFields";
import {
  runLocal,
  type Product,
  type Profile,
  type UseCase,
} from "../../lib/shuttle";
import type { Ctx } from "./types";

export default function ProductFacts({
  ctx,
  params,
  setParam,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
}) {
  const tab = ["facts", "usecases"].includes(params.product_tab)
    ? params.product_tab
    : "profile";
  const [draft, setDraft] = useState<Partial<Profile>>(ctx.profile);
  useEffect(() => setDraft(ctx.profile), [ctx.profile]);
  const { data, error, reload } = useProductData<{
    products: Product[];
    use_cases: UseCase[];
  }>("products.list", {}, ctx.rev);
  const [edit, setEdit] = useState<any>(null),
    [saveError, setSaveError] = useState("");
  const products = data?.products || [],
    cases = data?.use_cases || [];
  const save = async () => {
    try {
      await runLocal(
        tab === "usecases" ? "products.saveUseCase" : "products.save",
        edit,
      );
      setEdit(null);
      reload();
      return true;
    } catch (e) {
      setSaveError((e as Error).message);
      return false;
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={g("product_title")}
        desc={g("product_desc")}
        actions={
          <TaskTools
            task="import-products"
            label="import_product"
            onFinished={() => {
              reload();
              ctx.reloadProfile();
            }}
          />
        }
      />
      <WorkspaceTabs
        id="product"
        label={g("product_title")}
        value={tab}
        onChange={(v) => setParam("product_tab", v)}
        options={["profile", "facts", "usecases"].map((v) => ({
          value: v,
          label: g("tab_" + v),
        }))}
      />
      {tab === "profile" ? (
        <Panel title={g("tab_profile")}>
          <div className="space-y-4">
            <TextFields
              value={draft}
              onChange={setDraft}
              fields={[
                { key: "name" },
                { key: "website_url", type: "url" },
                { key: "positioning", long: true },
                { key: "customer_types", long: true },
                { key: "business", long: true },
                { key: "advantages", long: true },
                { key: "buyer_concerns", long: true },
                { key: "markets" },
                { key: "tone" },
                { key: "goal", long: true },
                { key: "signup_event" },
                { key: "activation_event" },
                { key: "paid_event" },
                { key: "brand_terms" },
                { key: "keywords", long: true },
                { key: "pricing", long: true },
                { key: "competitors", long: true },
                { key: "source_url", type: "url" },
                { key: "verified_at" },
              ]}
            />
            <Button
              fn="profile.save"
              onClick={async () => {
                await runLocal("profile.save", draft);
                ctx.reloadProfile();
              }}
            >
              {g("save_profile")}
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setSaveError("");
                setEdit(
                  tab === "usecases"
                    ? {
                        product_id:
                          products.find((p) => p.status !== "hidden")?.id || "",
                        status: "active",
                      }
                    : { status: "active" },
                );
              }}
              disabled={
                tab === "usecases" &&
                !products.some((p) => p.status !== "hidden")
              }
            >
              <Plus />
              {g(tab === "usecases" ? "add_usecase" : "add_product")}
            </Button>
          </div>
          <DataState loading={!data} error={error} />
          {data && !(tab === "usecases" ? cases : products).length && (
            <Empty
              text={tab === "usecases" ? "usecase_empty" : "product_empty"}
            />
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {(tab === "usecases" ? cases : products).map((p: any) => (
              <Panel
                key={p.id}
                title={p.title || p.name}
                aside={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={g("edit")}
                    onClick={() => {
                      setSaveError("");
                      setEdit(p);
                    }}
                  >
                    <Pencil />
                  </Button>
                }
              >
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {p.problem || p.summary}
                </p>
                {p.audience && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {g("field_audience")}：{p.audience}
                  </p>
                )}
                {p.status === "hidden" && (
                  <p className="mt-2 text-xs">{g("hidden")}</p>
                )}
                {(p.source_url || p.proof_url) && (
                  <a
                    className="mt-3 block truncate text-xs text-primary-text hover:underline"
                    href={p.source_url || p.proof_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {g("view_source")}
                  </a>
                )}
              </Panel>
            ))}
          </div>
        </>
      )}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={g(tab === "usecases" ? "edit_usecase" : "edit_product")}
        width={760}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {g("cancel")}
            </Button>
            <Button
              fn={tab === "usecases" ? "products.saveUseCase" : "products.save"}
              onClick={save}
            >
              {g("save")}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            {saveError && <Notice tone="error">{saveError}</Notice>}
            {tab === "usecases" && (
              <Choice
                name="product_id"
                value={edit.product_id || ""}
                onChange={(v) => setEdit({ ...edit, product_id: v })}
                options={products
                  .filter(
                    (p) => p.status !== "hidden" || p.id === edit.product_id,
                  )
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            <TextFields
              value={edit}
              onChange={setEdit}
              fields={
                tab === "usecases"
                  ? [
                      { key: "title" },
                      { key: "audience" },
                      { key: "problem", long: true },
                      { key: "workflow", long: true },
                      { key: "outcome", long: true },
                      { key: "proof_url", type: "url" },
                    ]
                  : [
                      { key: "name" },
                      { key: "audience" },
                      { key: "summary", long: true },
                      { key: "features", long: true },
                      { key: "limitations", long: true },
                      { key: "price", long: true },
                      { key: "proof", long: true },
                      { key: "url", type: "url" },
                      { key: "source_url", type: "url" },
                      { key: "verified_at" },
                      { key: "keywords" },
                    ]
              }
            />
            <Choice
              name="status"
              value={edit.status || "active"}
              onChange={(v) => setEdit({ ...edit, status: v })}
              options={["active", "hidden"].map((v) => ({
                value: v,
                label: g("status_" + v),
              }))}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
