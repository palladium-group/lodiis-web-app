import React, { useState } from "react";
import { useDataEngine } from "@dhis2/app-runtime";
import i18n from "@dhis2/d2-i18n";
import {
  Button,
  ButtonStrip,
  CheckboxField,
  CircularLoader,
  InputField,
  NoticeBox,
} from "@dhis2/ui";
import { planTransfer, executeTransfer } from "./api";
import type { TransferPlan } from "./types";
import { CAREGIVER_TRANSFER_CONFIG as CFG } from "./config";

export default function CaregiverTransfer(): React.ReactElement {
  const engine = useDataEngine();
  const [oldCg, setOldCg] = useState("");
  const [newCg, setNewCg] = useState("");
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [removeOld, setRemoveOld] = useState(true);
  const [createPrev, setCreatePrev] = useState(true);
  const [linkCg, setLinkCg] = useState(true);
  const [updateAttr, setUpdateAttr] = useState(true);
  const [newOu, setNewOu] = useState("");
  const [ignoreTypeFilter, setIgnoreTypeFilter] = useState(false);

  async function handlePreview() {
    setErr(null);
    setLoading(true);
    try {
      const p = await planTransfer(engine, oldCg, newCg, { ignoreTypeFilter });
      setPlan(p);
    } catch (e: any) {
      setPlan(null);
      setErr(e?.message || "Failed to fetch caregivers / relationships");
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (!plan) return;
    setErr(null);
    setLoading(true);
    try {
      await executeTransfer(engine, plan, {
        removeOldGuardianLink: removeOld,
        createPreviousGuardianLink: createPrev,
        linkOldNewCaregivers: linkCg,
        updateChildAttr: updateAttr,
        newOrgUnitForChildren: newOu || undefined,
      });
      setPlan(null);
      setOldCg("");
      setNewCg("");
      setNewOu("");
    } catch (e: any) {
      setErr(e?.message || "Transfer failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleChild(tei: string) {
    if (!plan) return;
    const next = plan.children.map(c => c.childTei === tei ? { ...c, selected: !c.selected } : c);
    setPlan({ ...plan, children: next });
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 960 }}>
      <h1 style={{ margin: 0 }}>{i18n.t("Caregiver Transfer")}</h1>
      <p style={{ color: "#555" }}>
        {i18n.t("Transfer selected children from an old caregiver to a new caregiver, and update relationships accordingly.")}
      </p>

      {/* DEBUG: show current config */}
      <div style={{ fontSize: 12, color: "#666" }}>
        <div>REL_TYPE_GUARDIAN_OF = <code>{CFG.REL_TYPE_GUARDIAN_OF}</code></div>
      </div>

      {err && <NoticeBox error title={i18n.t("Error")}>{err}</NoticeBox>}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <InputField
          label={i18n.t("Old Caregiver TEI UID")}
          placeholder="e.g. VUvcpH0jpjB"
          value={oldCg}
          onChange={({ value }: any) => setOldCg((value || '').trim())}
          disabled={loading}
        />
        <InputField
          label={i18n.t("New Caregiver TEI UID")}
          placeholder="e.g. AcH6v0cjUjH"
          value={newCg}
          onChange={({ value }: any) => setNewCg((value || '').trim())}
          disabled={loading}
        />
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <CheckboxField label={i18n.t("Remove old guardian-of link(s)")} checked={removeOld} onChange={({ checked }: any) => setRemoveOld(checked)} disabled={loading} />
        <CheckboxField label={i18n.t("Create previous-guardian-of history link(s)")} checked={createPrev} onChange={({ checked }: any) => setCreatePrev(checked)} disabled={loading || CFG.REL_TYPE_PREVIOUS_GUARDIAN_OF.startsWith("REPLACE_ME")} />
        <CheckboxField label={i18n.t("Link old caregiver → new caregiver (replaced-by)")} checked={linkCg} onChange={({ checked }: any) => setLinkCg(checked)} disabled={loading || CFG.REL_TYPE_CAREGIVER_REPLACED_BY.startsWith("REPLACE_ME")} />
        <CheckboxField label={i18n.t("Update child attribute with current caregiver TEI")} checked={updateAttr} onChange={({ checked }: any) => setUpdateAttr(checked)} disabled={loading || CFG.CHILD_ATTR_CURRENT_CAREGIVER_UID.startsWith("REPLACE_ME")} />
        <CheckboxField
          label={i18n.t("Ignore relationship type filter (debug)")}
          checked={ignoreTypeFilter}
          onChange={({ checked }: any) => setIgnoreTypeFilter(checked)}
          helpText={i18n.t("If enabled, any TEI↔TEI relationship will be treated as child link for preview.")}
          disabled={loading}
        />
      </div>

      <InputField
        label={i18n.t("New Org Unit for Children (optional)")}
        placeholder={i18n.t("Org unit UID for ownership transfer (leave blank to skip)")}
        value={newOu}
        onChange={({ value }: any) => setNewOu(value)}
        disabled={loading}
      />

      <ButtonStrip>
        <Button primary onClick={handlePreview} disabled={loading || !oldCg || !newCg}>
          {loading ? i18n.t("Working…") : i18n.t("Preview children")}
        </Button>
      </ButtonStrip>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CircularLoader small /> <span>{i18n.t("Loading")}</span>
        </div>
      )}

      {plan && (
        <div style={{ display: "grid", gap: 12 }}>
          {/* DEBUG summary */}
          <div style={{ fontSize: 12, color: "#444", background: "#fafafa", padding: 8, border: "1px dashed #ddd", borderRadius: 6 }}>
            <div><b>Old Caregiver:</b> <code>{plan.oldCaregiver.trackedEntityInstance}</code></div>
            <div><b>Relationships fetched:</b> {(plan.oldCaregiver.relationships || []).length}</div>
            <div>
              <b>Rel types seen:</b>{" "}
              {Array.from(new Set((plan.oldCaregiver.relationships || []).map((r: any) => r.relationshipType))).map((t: string) => (
                <code key={t} style={{ marginRight: 8 }}>{t}</code>
              ))}
            </div>
            <div><b>Children parsed:</b> {plan.children.length}</div>
          </div>

          <h2 style={{ margin: "8px 0 0" }}>{i18n.t("Children under old caregiver")}</h2>
          {plan.children.length === 0 ? (
            <NoticeBox title={i18n.t("No children found")}>
              {i18n.t("No guardian-of relationships were found for the old caregiver.")}
            </NoticeBox>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {plan.children.map(c => (
                <div key={c.childTei}
                  style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {c.name || i18n.t("Unknown name")}
                    </div>
                    <div style={{ color: "#777", fontSize: 12, marginTop: 2 }}>
                      TEI: <span style={{ fontFamily: "monospace" }}>{c.childTei}</span>
                    </div>
                    <div style={{ color: "#999", fontSize: 11 }}>
                      {i18n.t("Existing relationship ID")}: {c.existingRelId || "—"}
                    </div>
                  </div>
                  <CheckboxField
                    label={i18n.t("Transfer this child")}
                    checked={c.selected}
                    onChange={() => toggleChild(c.childTei)}
                  />
                </div>
              ))}
            </div>
          )}

          <ButtonStrip>
            <Button primary onClick={handleExecute} disabled={loading || plan.children.every(c => !c.selected)}>
              {i18n.t("Confirm & Execute")}
            </Button>
            <Button onClick={() => setPlan(null)} disabled={loading}>
              {i18n.t("Reset")}
            </Button>
          </ButtonStrip>
        </div>
      )}
    </div>
  );
}
