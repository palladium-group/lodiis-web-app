import { CAREGIVER_TRANSFER_CONFIG as CFG } from "./config";
import type { TeiMinimal, TransferPlan, TransferDirection } from "./types";

/** ---------- TEI fetch (embed relationships) ---------- */
export async function fetchTeiWithRels(engine: any, teiId: string): Promise<TeiMinimal> {
  const id = (teiId || "").trim();
  if (!id) throw new Error("Missing TEI id");

  const res = (await engine.query({
    tei: {
      resource: `trackedEntityInstances/${id}`,
      params: {
        fields: [
          "trackedEntityInstance",
          "orgUnit",
          "attributes[attribute,value]",
          "enrollments[enrollment,program,orgUnit,status]",
          // explicit edges (some builds still nest them oddly)
          "relationships[relationship,relationshipType,from[trackedEntity,trackedEntityInstance,enrollment,event],to[trackedEntity,trackedEntityInstance,enrollment,event]]",
        ].join(","),
      },
    },
  })) as { tei: any };

  return res.tei as TeiMinimal;
}

/** ---------- Relationships fetch (GET /relationships …) with guards ---------- */
async function fetchRelationshipsGET(engine: any, teiId: string): Promise<any[]> {
  const id = (teiId || "").trim();
  if (!id) return [];

  // Try ?tei=
  try {
    const r1 = (await engine.query({
      rels: {
        resource: "relationships",
        params: {
          tei: id,
          fields: [
            "relationship",
            "relationshipType",
            "from[trackedEntity,trackedEntityInstance,enrollment,event]",
            "to[trackedEntity,trackedEntityInstance,enrollment,event]",
          ].join(","),
          pageSize: 500,
        },
      },
    })) as { rels: { relationships?: any[] } };
    if (Array.isArray(r1?.rels?.relationships) && r1.rels.relationships.length) return r1.rels.relationships!;
  } catch { /* ignore and try next */ }

  // Try ?trackedEntityInstance=
  try {
    const r2 = (await engine.query({
      rels: {
        resource: "relationships",
        params: {
          trackedEntityInstance: id,
          fields: [
            "relationship",
            "relationshipType",
            "from[trackedEntity,trackedEntityInstance,enrollment,event]",
            "to[trackedEntity,trackedEntityInstance,enrollment,event]",
          ].join(","),
          pageSize: 500,
        },
      },
    })) as { rels: { relationships?: any[] } };
    if (Array.isArray(r2?.rels?.relationships) && r2.rels.relationships.length) return r2.rels.relationships!;
  } catch { /* ignore */ }

  return [];
}

/** ---------- Deep TEI id extraction + filters ---------- */
function findTeiIdDeep(node: any): string | undefined {
  if (!node) return undefined;
  if (typeof node === "string") return node;

  if (typeof node === "object") {
    if (typeof (node as any).trackedEntity === "string") return (node as any).trackedEntity;
    if (typeof (node as any).trackedEntityInstance === "string") return (node as any).trackedEntityInstance;

    const te = (node as any).trackedEntity;
    const tei = (node as any).trackedEntityInstance;
    if (te && typeof te === "object") {
      const v = findTeiIdDeep(te);
      if (v) return v;
    }
    if (tei && typeof tei === "object") {
      const v = findTeiIdDeep(tei);
      if (v) return v;
    }
    for (const k of Object.keys(node)) {
      const v = findTeiIdDeep((node as any)[k]);
      if (v) return v;
    }
  }
  return undefined;
}
function isTeiEdgeEnd(node: any): boolean {
  return !!findTeiIdDeep(node) && !node?.event && !node?.enrollment;
}

/** ---------- Direction detection (mirror your existing data) ---------- */
function determineDirection(
  caregiverId: string,
  relationships: any[],
  typeFilter: string | null
): TransferDirection {
  let fromCount = 0;
  let toCount = 0;
  for (const r of relationships || []) {
    if (typeFilter && r.relationshipType !== typeFilter) continue;
    if (!isTeiEdgeEnd(r.from) || !isTeiEdgeEnd(r.to)) continue;
    const fromTei = findTeiIdDeep(r.from);
    const toTei = findTeiIdDeep(r.to);
    if (!fromTei || !toTei) continue;
    if (fromTei === caregiverId) fromCount++;
    if (toTei === caregiverId) toCount++;
  }
  return fromCount >= toCount ? "caregiver_to_child" : "child_to_caregiver";
}

/** ---------- Parse children from relationship array ---------- */
export function getChildrenUnderCaregiver(
  caregiver: TeiMinimal,
  opts?: { typeFilter?: string | null }
): Array<{ childTei: string; relId?: string; relType?: string }> {
  const out: Array<{ childTei: string; relId?: string; relType?: string }> = [];
  const caregiverId = caregiver.trackedEntityInstance;

  for (const r of caregiver.relationships || []) {
    if (opts?.typeFilter && r.relationshipType !== opts.typeFilter) continue;
    if (!isTeiEdgeEnd(r.from) || !isTeiEdgeEnd(r.to)) continue;

    const fromTei = findTeiIdDeep(r.from)!;
    const toTei = findTeiIdDeep(r.to)!;

    if (fromTei === caregiverId && toTei) {
      out.push({ childTei: toTei, relId: r.relationship, relType: r.relationshipType });
    } else if (toTei === caregiverId && fromTei) {
      out.push({ childTei: fromTei, relId: r.relationship, relType: r.relationshipType });
    }
  }

  const seen = new Set<string>();
  return out.filter(x => (seen.has(x.childTei) ? false : (seen.add(x.childTei), true)));
}

/** ---------- Create / Delete relationships ---------- */
/** Build a Tracker Importer RelationshipItem for a TEI endpoint. */
function trackerRelItemTei(uid: string) {
  // Tracker Importer expects nested typed objects, e.g.
  // { from: { trackedEntity: { trackedEntity: "UID" } }, to: { trackedEntity: { trackedEntity: "UID" } } }
  return { trackedEntity: { trackedEntity: uid } };
}

/**
 * Create a relationship:
 * 1) Prefer Tracker Importer bundle (POST /tracker) with NESTED TEI objects (fixes your 500 error)
 * 2) Fallback to legacy /relationships using 'trackedEntity'
 * 3) Fallback to legacy /relationships using 'trackedEntityInstance'
 */
export async function createRelationship(
  engine: any,
  p: { relationshipType: string; fromTei: string; toTei: string }
) {
  // --- Try #1: Tracker Importer (POST /tracker) with nested TEI objects
  try {
    const trackerRes: any = await engine.mutate({
      type: "create",
      resource: "tracker",
      params: { importStrategy: "CREATE" },
      data: {
        relationships: [
          {
            relationshipType: p.relationshipType,
            from: trackerRelItemTei(p.fromTei),
            to:   trackerRelItemTei(p.toTei),
          },
        ],
      },
    });

    const r = trackerRes?.response || trackerRes;
    const status = r?.status || r?.importStatus || r?.responseType;
    const ignored =
      r?.ignored ?? r?.stats?.ignored ?? r?.importSummaries?.[0]?.importCount?.ignored ?? 0;

    if (status === "OK" || status === "SUCCESS" || ignored === 0) return trackerRes;

    const conflicts =
      r?.importSummaries?.[0]?.conflicts?.map((c: any) => c?.value)?.join("; ");
    throw new Error(conflicts ? `Tracker relationship rejected: ${conflicts}` : "Tracker relationship rejected");
  } catch {
    // --- Try #2: Legacy /relationships (trackedEntity)
    try {
      return await engine.mutate({
        type: "create",
        resource: "relationships",
        data: {
          relationshipType: p.relationshipType,
          from: { trackedEntity: p.fromTei },
          to:   { trackedEntity: p.toTei   },
        },
      });
    } catch {
      // --- Try #3: Legacy /relationships (trackedEntityInstance)
      return await engine.mutate({
        type: "create",
        resource: "relationships",
        data: {
          relationshipType: p.relationshipType,
          from: { trackedEntityInstance: p.fromTei },
          to:   { trackedEntityInstance: p.toTei   },
        },
      });
    }
  }
}

export async function deleteRelationship(engine: any, relationshipId?: string) {
  if (!relationshipId) return;
  return engine.mutate({ type: "delete", resource: `relationships/${relationshipId}` });
}

/** ---------- Optional helpers ---------- */
export async function updateChildCaregiverAttribute(engine: any, childTei: string, newCaregiverTei: string) {
  if (!CFG.CHILD_ATTR_CURRENT_CAREGIVER_UID || CFG.CHILD_ATTR_CURRENT_CAREGIVER_UID.startsWith("REPLACE_ME")) return;

  const tei = await fetchTeiWithRels(engine, childTei);
  const attributes = (tei.attributes || []).filter(a => a.attribute !== CFG.CHILD_ATTR_CURRENT_CAREGIVER_UID);
  attributes.push({ attribute: CFG.CHILD_ATTR_CURRENT_CAREGIVER_UID, value: newCaregiverTei });

  await engine.mutate({
    type: "update",
    resource: `trackedEntityInstances/${childTei}`,
    data: { trackedEntityInstance: childTei, orgUnit: tei.orgUnit, attributes },
  });
}

export async function transferOwnership(engine: any, childTei: string, program: string, toOrgUnit: string) {
  try {
    await engine.mutate({
      type: "create",
      resource: "tracker/ownership/transfer",
      data: { program, trackedEntityInstance: childTei, orgUnit: toOrgUnit },
    });
  } catch { /* ignore if unsupported */ }
}

/** ---------- Build plan (embed + merge relationships, detect direction) ---------- */
export async function planTransfer(
  engine: any,
  oldCaregiverId: string,
  newCaregiverId: string,
  opts?: { ignoreTypeFilter?: boolean }
): Promise<TransferPlan> {
  const oldId = (oldCaregiverId || "").trim();
  const newId = (newCaregiverId || "").trim();
  if (!oldId || !newId) throw new Error("Both caregiver TEI ids are required");

  const [oldCg, newCg] = await Promise.all([fetchTeiWithRels(engine, oldId), fetchTeiWithRels(engine, newId)]);

  // Start with TEI-embedded relationships
  let rels: any[] = Array.isArray(oldCg.relationships) ? [...oldCg.relationships] : [];

  // Merge in GET /relationships results if available
  try {
    const extra = await fetchRelationshipsGET(engine, oldId);
    if (Array.isArray(extra) && extra.length) {
      const byId = new Map<string, any>();
      for (const r of [...rels, ...extra]) {
        if (r?.relationship) byId.set(r.relationship, r);
      }
      rels = Array.from(byId.values());
    }
  } catch { /* ignore 400/405 and keep embedded list */ }

  (oldCg as any).relationships = rels;

  const configuredType =
    CFG.REL_TYPE_GUARDIAN_OF && !CFG.REL_TYPE_GUARDIAN_OF.startsWith("REPLACE_ME")
      ? CFG.REL_TYPE_GUARDIAN_OF
      : null;

  const typeForDirection = opts?.ignoreTypeFilter ? null : configuredType;
  const expectedDirection = determineDirection(oldId, rels, typeForDirection);

  // Strict parse first (unless UI ignores); fallback to no filter if edges exist but none match type
  const strict = opts?.ignoreTypeFilter ? [] : getChildrenUnderCaregiver(oldCg, { typeFilter: configuredType });
  const chosen = strict && strict.length ? strict : (rels.length ? getChildrenUnderCaregiver(oldCg, { typeFilter: null }) : []);

  const children = chosen.map(({ childTei, relId }) => ({
    childTei,
    selected: true,
    existingRelId: relId,
  }));

  return { oldCaregiver: oldCg, newCaregiver: newCg, children, expectedDirection };
}

/** ---------- Execute (mirror direction, then clean-up/history/attr/ownership) ---------- */
export async function executeTransfer(
  engine: any,
  plan: TransferPlan,
  options: {
    removeOldGuardianLink: boolean;
    createPreviousGuardianLink: boolean;
    linkOldNewCaregivers: boolean;
    updateChildAttr: boolean;
    newOrgUnitForChildren?: string;
  }
) {
  const { oldCaregiver, newCaregiver, children, expectedDirection } = plan;
  const tasks: Promise<any>[] = [];

  // Optional caregiver→caregiver link
  if (
    options.linkOldNewCaregivers &&
    CFG.REL_TYPE_CAREGIVER_REPLACED_BY &&
    !CFG.REL_TYPE_CAREGIVER_REPLACED_BY.startsWith("REPLACE_ME")
  ) {
    tasks.push(
      createRelationship(engine, {
        relationshipType: CFG.REL_TYPE_CAREGIVER_REPLACED_BY,
        fromTei: oldCaregiver.trackedEntityInstance,
        toTei: newCaregiver.trackedEntityInstance,
      })
    );
  }

  for (const c of children.filter(x => x.selected)) {
    // Mirror existing direction for new link
    if (expectedDirection === "caregiver_to_child") {
      // caregiver -> child
      tasks.push(
        createRelationship(engine, {
          relationshipType: CFG.REL_TYPE_GUARDIAN_OF,
          fromTei: newCaregiver.trackedEntityInstance,
          toTei: c.childTei,
        })
      );
    } else {
      // child -> caregiver
      tasks.push(
        createRelationship(engine, {
          relationshipType: CFG.REL_TYPE_GUARDIAN_OF,
          fromTei: c.childTei,
          toTei: newCaregiver.trackedEntityInstance,
        })
      );
    }

    if (options.removeOldGuardianLink && c.existingRelId) {
      tasks.push(deleteRelationship(engine, c.existingRelId));
    }

    if (
      options.createPreviousGuardianLink &&
      CFG.REL_TYPE_PREVIOUS_GUARDIAN_OF &&
      !CFG.REL_TYPE_PREVIOUS_GUARDIAN_OF.startsWith("REPLACE_ME")
    ) {
      // record history as child -> OLD caregiver
      tasks.push(
        createRelationship(engine, {
          relationshipType: CFG.REL_TYPE_PREVIOUS_GUARDIAN_OF,
          fromTei: c.childTei,
          toTei: oldCaregiver.trackedEntityInstance,
        })
      );
    }

    if (options.updateChildAttr) {
      tasks.push(updateChildCaregiverAttribute(engine, c.childTei, newCaregiver.trackedEntityInstance));
    }

    if (options.newOrgUnitForChildren && !options.newOrgUnitForChildren.startsWith("REPLACE_ME")) {
      tasks.push(transferOwnership(engine, c.childTei, CFG.CHILD_PROGRAM_UID, options.newOrgUnitForChildren));
    }
  }

  await Promise.all(tasks);
}
