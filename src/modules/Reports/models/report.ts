// src/modules/custom-reports/classes/CustomReport.ts

import {
  CustomReportInterface,
  ReportDxConfig,
} from "../../../shared/interfaces/report";
import {
  compact,
  concat,
  filter,
  find,
  flattenDeep,
  fromPairs,
  groupBy,
  isEmpty,
  keys,
  last,
  map,
  mapValues,
  omit,
  split,
  sumBy,
  uniq,
  uniqBy,
  values,
} from "lodash";
import {
  CUSTOM_DX_CONFIG_IDS,
  DEFAULT_ANALYTICS_KEYS,
  PAGE_SIZE,
} from "../../../constants/reports";
import {
  Analytics,
  Pagination,
  PeriodUtility,
  Program,
} from "@hisptz/dhis2-utils";
import { asyncify, mapSeries } from "async-es";
import { getFormattedEventAnalyticDataForReport } from "../helpers/get-formatted-analytics-data";
import { CustomDataTableColumn } from "@hisptz/dhis2-ui";
import { defaultCustomDxConfigIds } from "../helpers/get-analytics-parameters";
import { Dispatch, SetStateAction } from "react";

interface EventVariables {
  program: string;
  dx: string[];
  stage: string;
}

interface EnrollmentVariables {
  program: string;
  dx: string[];
}

interface QueryVariables {
  params: EventVariables | EnrollmentVariables | Record<string, any>;
  pagination: Pagination;
}

function ensureStr(v: string | undefined | null, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Candidate identifiers to group “per TEI” when TEI is absent */
const TEI_FALLBACK_KEYS = [
  "tei",
  "trackedEntity",
  "trackedEntityInstance",
  "eIU7KMx4Tu3", // Beneficiary Code (instance-specific)
  "pi",          // enrollment id
  "uid",         // event uid (last resort)
];

/** Strict Yes/No */
function toYesNo(v: any): "Yes" | "No" {
  if (v === true || v === false) return v ? "Yes" : "No";
  if (v == null) return "No";
  if (typeof v === "number") return v !== 0 ? "Yes" : "No";
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y" || s === "t" || s === "on"
    ? "Yes"
    : "No";
}

/** force every isBoolean col to Yes/No on (stage.id, id, name) */
function enforceBooleanYesNo(
  rows: Array<Record<string, any>>,
  dxConfigs: ReportDxConfig[],
): Array<Record<string, any>> {
  if (!rows?.length) return rows;

  const boolCfgs = dxConfigs.filter((c) => c.isBoolean && !c.isAttribute);

  return rows.map((r) => {
    const out = { ...r };

    for (const cfg of boolCfgs) {
      const id = (cfg.id ?? "") as string;
      const stage = (cfg.programStage ?? "") as string;
      const name = (cfg.name ?? "") as string;
      if (!id) continue;

      const stagedKey = stage ? `${stage}.${id}` : "";

      const firstSeen =
        (name && out[name] !== undefined ? out[name] : undefined) ??
        (stagedKey && out[stagedKey] !== undefined ? out[stagedKey] : undefined) ??
        (out[id] !== undefined ? out[id] : undefined) ??
        "No";

      const yn = toYesNo(firstSeen);

      if (name) out[name] = yn;
      if (stagedKey) out[stagedKey] = yn;
      out[id] = yn;
    }

    return out;
  });
}

/**
 * Reports that should ONLY include TEIs that have at least one event
 * in a specific program stage for the selected period.
 *
 * key = report id
 * value = array of stage ids that must be present
 */
const STAGE_RESTRICTED_REPORTS: Record<string, string[]> = {
  "consolidated_OVC_Services_Provision": ["CHFwighOquA", "vcaHzmUuYzU"],
};

/** Which stages are “Service Provision” for is_service_provided */
const SERVICE_PROVISION_STAGE_SET = new Set<string>(["CHFwighOquA", "vcaHzmUuYzU"]);
const SERVICE_PROVIDED_ID = "is_service_provided";
const SERVICE_PROVIDED_NAME = "SERVICES PROVIDED?";

export class CustomReport {
  config: CustomReportInterface;
  data?: Record<string, any>[];
  programsMetadata?: Program[];

  constructor(config: CustomReportInterface) {
    this.config = config;
  }

  get programs() {
    return flattenDeep([this.config.program]);
  }

  get dataItems(): ReportDxConfig[] {
    const exploded = flattenDeep(
      this.config.dxConfigs.map((attribute: ReportDxConfig) => {
        if (!attribute.ids || isEmpty(attribute.ids)) return attribute;
        return attribute.ids?.map((id: string) => ({ ...attribute, id }));
      }) as ReportDxConfig[],
    );

    return uniqBy(
      exploded,
      (cfg) =>
        `${cfg.id ?? ""}::${cfg.programStage ?? ""}::${cfg.name ?? ""}`,
    ).filter((config) => {
      return !Object.values(CUSTOM_DX_CONFIG_IDS).includes(
        config.id as CUSTOM_DX_CONFIG_IDS,
      );
    });
  }

  get id() {
    return this.config.id;
  }

  get name() {
    return this.config.name;
  }

  get disableOrgUnitSelection() {
    return this.config.disableOrgUnitSelection;
  }

  get disablePeriodSelection() {
    return this.config.disablePeriodSelection;
  }

  get attributes(): ReportDxConfig[] {
    return filter(
      this.dataItems,
      ({ isAttribute }) => isAttribute === true,
    ) as ReportDxConfig[];
  }

  get reportProgramStageIds(): string[] {
    return filter(
      uniq(
        flattenDeep(
          this.dataItems.map((item) => [
            item.programStage ?? "",
            ...map(item.programStages ?? [], ({ id }) => id),
          ]),
        ) as string[],
      ),
      (stage) => stage !== "",
    );
  }

  get dataElements(): ReportDxConfig[] {
    return flattenDeep(
      map(
        flattenDeep(
          filter(
            this.dataItems.map((item) => {
              if (!item.programStages || isEmpty(item.programStages)) {
                return item;
              }
              return flattenDeep(
                item.programStages.map((stage) => {
                  return (
                    stage.dataElements.map((dataElement) => ({
                      ...item,
                      id: dataElement,
                      programStage: stage.id,
                    })) ?? []
                  );
                }),
              );
            }),
            ({ isAttribute }: any) => !isAttribute,
          ) as ReportDxConfig[],
        ),
        (item) => {
          if (item.programStage && item.programStage !== "") return [item];
          return map(this.reportProgramStageIds, (stage) => {
            const progranStageObj = find(this.programsMetadata, (program) => {
              return !!find(program.programStages, ["id", stage]);
            });
            if (progranStageObj) {
              const programStage = find(progranStageObj.programStages, ["id", stage]);
              const dataElemetIds =
                programStage?.programStageDataElements?.map(
                  ({ dataElement }) => dataElement.id,
                );
              if (dataElemetIds?.includes(ensureStr(item.id))) {
                return { ...item, programStage: stage };
              }
            }
            return item;
          });
        },
      ),
    ) as ReportDxConfig[];
  }

  get enrollmentAnalyticsParameters() {
    return this.programs
      .map((program) => {
        const attributes = this.getAttributesByProgram(program);
        return {
          program,
          dx: uniq(attributes.map(({ id }) => ensureStr(id))).filter(Boolean),
        };
      })
      .filter(({ dx }) => !isEmpty(dx));
  }

  get eventAnalyticsParameters(): EventVariables[] {
    const groupedDataElements = omit(
      mapValues(
        groupBy(this.dataElements, "programStage"),
        (dataElements, programStage) => [
          ...dataElements,
          ...map(
            filter(
              this.dataElements,
              ({ crossStages, programStage }) => crossStages && !programStage,
            ),
            (dataElement: ReportDxConfig) => ({
              ...dataElement,
              programStage,
            }),
          ),
        ],
      ),
      "",
    );

    const sanitizedDataElements = mapValues(
      groupedDataElements,
      (dataElements, stage) => {
        const program = this.getProgramByStage(stage);
        if (!program) return dataElements;
        const attributes = this.getAttributesByProgram(program);
        return [
          ...dataElements,
          ...attributes.map((attribute) => ({
            ...attribute,
            program,
            programStage: stage,
          })),
        ];
      },
    );

    const vars = keys(sanitizedDataElements).map((stage) => {
      const elements = sanitizedDataElements[stage] as ReportDxConfig[];
      const dxList = uniq(
        compact(
          flattenDeep(
            elements.map((element: ReportDxConfig) => {
              const st = ensureStr(stage);
              if (defaultCustomDxConfigIds.includes(ensureStr(element.id))) {
                return undefined;
              }
              if ((element.ids ?? []).length) {
                return element.ids!.map((id) => `${st}.${id}`);
              }
              if (element.id) return `${st}.${element.id}`;
              return undefined;
            }) as string[],
          ),
        ),
      );
      const program = this.getProgramByStage(stage);
      return { dx: dxList, program, stage: ensureStr(stage) };
    });

    return vars
      .filter((v) => !!v.program && v.stage)
      .map((v) => ({ dx: v.dx, program: ensureStr(v.program), stage: v.stage })) as EventVariables[];
  }

  get programToProgramStages() {
    if (!this.programsMetadata) return {};
    return fromPairs(
      this.programsMetadata.map((program) => [
        program.id,
        program.programStages,
      ]),
    );
  }

  setProgramMetadata(programs: Program[]) {
    if (!programs || !programs.length) {
      throw Error("Empty programs metadata passed to setProgramMetadata");
    }
    this.programsMetadata = programs;
  }

  getAttributesByProgram(programId: string): ReportDxConfig[] {
    if (!this.programsMetadata) {
      throw Error("Programs metadata not found. Call `setProgramMetadata` first");
    }
    const programMetadata = find(this.programsMetadata, ["id", programId]);
    if (programMetadata) {
      return filter(this.attributes, (attribute) => {
        return !!find(programMetadata.programTrackedEntityAttributes, [
          "trackedEntityAttribute.id",
          attribute.id,
        ]);
      });
    }
    return [];
  }

  getProgramByStage(programStage: string): string | undefined {
    if (!this.programsMetadata) {
      throw Error("Programs metadata not found. Call `setProgramMetadata` first");
    }
    return find(this.programsMetadata, (program) => {
      return !!find(program.programStages, ["id", programStage]);
    })?.id;
  }

  /** Detect tidy (dx/value) header presence */
  private isTidyPairHeaders(headers: any[] | undefined): boolean {
    const names = headers?.map((h: any) => h?.name) ?? [];
    return names.includes("dx") && (names.includes("value") || names.includes("val") || names.includes("Value"));
  }

  // Map all headers to original + last segment, and MATERIALIZE tidy -> `${stage}.${de}`
  sanitizeAnalyticsData(data: Analytics, options?: { stage?: string }) {
    const { headers = [], rows = [] } = data ?? {};

    const headerIndex: Record<string, number> = {};
    const headerNames: string[] = [];
    headers.forEach((h: any, i: number) => {
      if (h && typeof h.name === "string") {
        headerIndex[h.name] = i;
        headerNames.push(h.name);
      }
    });

    let rowsArr: any[][];
    if (Array.isArray(rows)) {
      if (rows.length > 0 && Array.isArray((rows as any)[0])) {
        rowsArr = (rows as unknown) as any[][];
      } else {
        rowsArr = [(rows as unknown) as any[]];
      }
    } else {
      rowsArr = [];
    }

    const looksTidy = this.isTidyPairHeaders(headers);

    return rowsArr.map((row) => {
      const obj: Record<string, any> = { programStage: options?.stage };

      for (const key of headerNames) {
        const idx = headerIndex[key];
        if (typeof idx !== "number" || idx < 0) continue;
        const val = row[idx];

        obj[key] = val;

        const alias = last(split(key, ".")) ?? key;
        if (alias && obj[alias] === undefined) {
          obj[alias] = val;
        }

        if (key === "dx" && typeof val === "string") {
          obj.dxFull = val;
          obj.dxLast = (val.split(".").pop() as string) || val;
        }
      }

      if (looksTidy) {
        const stageId = ensureStr(options?.stage);
        const valueCell = obj.value ?? obj.val ?? obj.Value;
        const deId = ensureStr(obj.dxLast);
        if (stageId && deId && valueCell !== undefined) {
          const stagedKey = `${stageId}.${deId}`;
          obj[stagedKey] = valueCell;
        }
      }

      return obj;
    });
  }

  private normalizeBoolean(v: any): boolean {
    if (v === true || v === false) return v;
    if (v == null) return false;
    if (typeof v === "number") return v !== 0;
    const n = Number(v);
    if (!Number.isNaN(n)) return n !== 0;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1" || s === "y" || s === "t" || s === "on";
  }

  private getBooleanStageDxMap(): Record<string, string[]> {
    const mapByStage: Record<string, string[]> = {};
    for (const cfg of this.config.dxConfigs) {
      if (cfg.isBoolean === true && cfg.isAttribute !== true) {
        const stage = ensureStr(cfg.programStage);
        const id = ensureStr(cfg.id);
        if (!stage || !id) continue;
        if (!mapByStage[stage]) mapByStage[stage] = [];
        if (!mapByStage[stage].includes(id)) mapByStage[stage].push(id);
      }
    }
    return mapByStage;
  }

  private getRowTeiLikeKey(r: Record<string, any>): string {
    for (const k of TEI_FALLBACK_KEYS) {
      if (r[k]) return String(r[k]);
    }
    return "";
  }

  private markBooleanYes(base: Record<string, any>, stage: string, deId: string, displayName: string) {
    base[deId] = "Yes";
    base[`${stage}.${deId}`] = "Yes";
    base[displayName] = "Yes";
  }

  private reduceBooleanEventsAnyTrue(rows: Array<Record<string, any>>): Array<Record<string, any>> {
    if (!rows?.length) return rows;

    const stageDx = this.getBooleanStageDxMap();
    if (isEmpty(stageDx)) return rows;

    const groups = groupBy(rows, (r) => {
      const teiLike = this.getRowTeiLikeKey(r) || ensureStr((r as any).uid) || "NO_TEI";
      const stage = ensureStr((r as any).programStage);
      return `${teiLike}::${stage}`;
    });

    const nameByIdStage: Record<string, string> = {};
    for (const cfg of this.config.dxConfigs) {
      const id = ensureStr(cfg.id);
      const st = ensureStr(cfg.programStage);
      const nm = ensureStr(cfg.name);
      if (id && st && nm) nameByIdStage[`${st}.${id}`] = nm;
      if (id && nm) nameByIdStage[id] = nm;
    }

    const out: Record<string, any>[] = [];

    for (const key of Object.keys(groups)) {
      const groupRows = groups[key];
      if (!groupRows?.length) continue;

      const base = { ...groupRows[0] };
      const stage = ensureStr((base as any).programStage);
      const boolDxForStage = stageDx[stage] ?? [];

      for (const deId of boolDxForStage) {
        const stagedKey = `${stage}.${deId}`;
        const anyTrue = groupRows.some((r) =>
          this.normalizeBoolean((r as any)[stagedKey] ?? (r as any)[deId]),
        );

        if (anyTrue) {
          const displayName = ensureStr(nameByIdStage[stagedKey] ?? nameByIdStage[deId] ?? deId);
          this.markBooleanYes(base, stage, deId, displayName);
        }
      }

      const teiLike = this.getRowTeiLikeKey(base) || ensureStr((base as any).uid) || "NO_TEI";
      (base as any).id = (base as any).id ?? `${teiLike}::${stage}`;

      out.push(base);
    }

    return out;
  }

  private copyValuesToDisplayColumns(rows: Array<Record<string, any>>): Array<Record<string, any>> {
    if (!rows?.length) return rows;

    const configs = this.config.dxConfigs;
    return rows.map((r) => {
      const out = { ...r };
      for (const cfg of configs) {
        const id = ensureStr(cfg.id);
        const stage = ensureStr(cfg.programStage);
        const name = ensureStr(cfg.name);
        if (!name) continue;

        const stagedKey = stage && id ? `${stage}.${id}` : "";
        const candidates = [stagedKey, id].filter(Boolean);

        for (const k of candidates) {
          if ((out as any)[k] !== undefined && (out as any)[name] === undefined) {
            (out as any)[name] = (out as any)[k];
          }
        }
      }
      return out;
    });
  }

  private mergeSameNameBooleanColumns(rows: Array<Record<string, any>>): Array<Record<string, any>> {
    if (!rows?.length) return rows;

    const groupsByName: Record<string, Array<{ stage: string; id: string }>> = {};
    for (const cfg of this.config.dxConfigs) {
      if (cfg.isBoolean && !cfg.isAttribute) {
        const name = ensureStr(cfg.name);
        const stage = ensureStr(cfg.programStage);
        const id = ensureStr(cfg.id);
        if (!name || !id) continue;
        if (!groupsByName[name]) groupsByName[name] = [];
        groupsByName[name].push({ stage, id });
      }
    }

    return rows.map((r) => {
      const out = { ...r };
      for (const [name, members] of Object.entries(groupsByName)) {
        if (members.length <= 1) continue;

        const anyYes = members.some(({ stage, id }) => {
          const stagedKey = stage ? `${stage}.${id}` : id;
          const v =
            (out as any)[name] ??
            (out as any)[stagedKey] ??
            (out as any)[id];
          return this.normalizeBoolean(v);
        });

        (out as any)[name] = anyYes ? "Yes" : "No";
      }
      return out;
    });
  }

  /** helper: check if a row's event falls inside any of the selected periods */
  private isRowInSelectedPeriods(
    row: Record<string, any>,
    selectedPeriods: string[],
  ): boolean {
    if (!selectedPeriods?.length) return true;

    const pe = ensureStr((row as any).pe);
    if (pe && selectedPeriods.includes(pe)) {
      return true;
    }

    const eventDateStr =
      ensureStr((row as any).eventdate) ||
      ensureStr((row as any).eventDate);

    if (!eventDateStr) return true;

    const dt = new Date(eventDateStr);
    if (Number.isNaN(dt.getTime())) return true;

    const ranges = selectedPeriods
      .map((p) => {
        try {
          const per = PeriodUtility.getPeriodById(p);
          return {
            start: per.start.toJSDate(),
            end: per.end.toJSDate(),
          };
        } catch (e) {
          return null;
        }
      })
      .filter((x): x is { start: Date; end: Date } => !!x);

    if (!ranges.length) return true;

    return ranges.some(({ start, end }) => dt >= start && dt <= end);
  }

  /**
   * Compute is_service_provided:
   *  Yes iff TEI has at least one boolean "Yes" in any SERVICE_PROVISION_STAGE_SET
   *  event that lies inside the selected period(s).
   */
  private enforceIsServiceProvidedByYesValue(
    rows: Array<Record<string, any>>,
    selectedPeriods: string[],
  ): Array<Record<string, any>> {
    if (!rows?.length) return rows;

    const stageToBoolIds = this.getBooleanStageDxMap();
    if (isEmpty(stageToBoolIds)) return rows;

    const byTei = groupBy(
      rows,
      (r) => this.getRowTeiLikeKey(r) || String((r as any).uid ?? ""),
    );

    for (const [, group] of Object.entries(byTei)) {
      const groupRows = group as Record<string, any>[];
      let hasService = false;

      outer: for (const row of groupRows) {
        if (!this.isRowInSelectedPeriods(row, selectedPeriods)) continue;

        const stage = ensureStr((row as any).programStage);
        if (!SERVICE_PROVISION_STAGE_SET.has(stage)) continue;

        const boolIds = stageToBoolIds[stage] ?? [];
        for (const deId of boolIds) {
          const stagedKey = `${stage}.${deId}`;
          const v = (row as any)[stagedKey] ?? (row as any)[deId];
          if (this.normalizeBoolean(v)) {
            hasService = true;
            break outer;
          }
        }
      }

      for (const row of groupRows) {
        (row as any)[SERVICE_PROVIDED_ID] = hasService ? "Yes" : "No";
        (row as any)[SERVICE_PROVIDED_NAME] = hasService ? "Yes" : "No";
      }
    }

    return rows;
  }

  /** keep only rows whose TEI has at least one row in the required stage(s) */
  private filterRowsByRequiredStages(
    rows: Array<Record<string, any>>,
    stages: string[],
  ): Array<Record<string, any>> {
    if (!rows?.length || !stages?.length) return rows;

    const teiToHasStage: Record<string, boolean> = {};

    for (const r of rows) {
      const tei = this.getRowTeiLikeKey(r) || ensureStr((r as any).uid);
      const st = ensureStr((r as any).programStage);
      if (!tei) continue;
      if (st && stages.includes(st)) {
        teiToHasStage[tei] = true;
      }
    }

    return rows.filter((r) => {
      const tei = this.getRowTeiLikeKey(r) || ensureStr((r as any).uid);
      if (!tei) return false;
      return !!teiToHasStage[tei];
    });
  }

  async getEnrollmentData(
    variableParams: Array<QueryVariables>,
    {
      getEnrollments,
      setProgress,
    }: {
      getEnrollments: (options: Record<string, any>) => Promise<Record<string, any>>;
      setProgress: Dispatch<SetStateAction<number>>;
    },
  ) {
    return await mapSeries(
      variableParams,
      asyncify(async ({ params, pagination }: QueryVariables) => {
        try {
          const total = Math.ceil((pagination.total as number) / PAGE_SIZE);
          const pages = Array.from({ length: total }, (_, i) => i + 1);
          return await mapSeries(
            pages,
            asyncify(async (page: number) => {
              try {
                const { data } = await getEnrollments({
                  ...(params as Record<string, any>),
                  page,
                });
                setProgress((prevProgress: number) => prevProgress + 1);
                return this.sanitizeAnalyticsData(data);
              } catch (error) {
                console.error("[Enrollment page fetch failed]", { error, page });
                return [];
              }
            }),
          );
        } catch (e) {
          console.error(e);
          return [];
        }
      }),
    );
  }

  async getEventsData(
    variablesParams: Array<QueryVariables>,
    {
      getEvents,
      setProgress,
    }: {
      getEvents: (options: Record<string, any>) => Promise<Record<string, any>>;
      setProgress: Dispatch<SetStateAction<number>>;
    },
  ) {
    const eventsVariables: EventVariables[] = this.eventAnalyticsParameters;
    if (isEmpty(eventsVariables)) return [];

    return await mapSeries(
      variablesParams,
      asyncify(
        async ({ params, pagination }: { params: Record<string, any>; pagination: Pagination }) => {
          try {
            const pages = Array.from({ length: pagination.pageCount as number }, (_, i) => i + 1);

            return await mapSeries(
              pages,
              asyncify(async (page: number) => {
                try {
                  const { data } = await getEvents({
                    ...params,
                    page,
                  });
                  setProgress((prevProgress: number) => prevProgress + 1);
                  return this.sanitizeAnalyticsData(data, { stage: ensureStr((params as any).stage) });
                } catch (error) {
                  console.error("[Events page fetch failed]", { error, page });
                  return [];
                }
              }),
            );
          } catch (e) {
            console.error(e);
            return [];
          }
        },
      ),
    );
  }

  async getEventPaginationAndParams(
    { orgUnits, periods }: { orgUnits: string[]; periods: string[] },
    {
      getEvents,
    }: {
      getEvents: (options: Record<string, any>) => Promise<Record<string, any>>;
    },
  ): Promise<Array<QueryVariables>> {
    const eventsVariables: EventVariables[] = this.eventAnalyticsParameters;
    if (isEmpty(eventsVariables)) return [];

    return mapSeries(
      eventsVariables,
      asyncify(async ({ program, stage, dx }: EventVariables) => {
        const baseRequestObject = {
          program: ensureStr(program),
          stage: ensureStr(stage),
          dx,
          ou: orgUnits,
          page: 1,
          pageSize: PAGE_SIZE,
          skipMeta: false,
          skipData: false,
        };
        const requestObject =
          this.config.endDateSelection === true
            ? {
                ...baseRequestObject,
                startDate: "1980-02-20",
                endDate: PeriodUtility.getPeriodById(periods[0]).end.toFormat("yyyy-MM-dd"),
              }
            : {
                ...baseRequestObject,
                pe: periods,
              };

        const pagination = await this.getPagination(requestObject, { getter: getEvents });
        return { params: requestObject, pagination };
      }),
    );
  }

  async getEnrollmentPaginationAndParams(
    { orgUnits, periods }: { orgUnits: string[]; periods: string[] },
    {
      getEnrollments,
    }: {
      getEnrollments: (options: Record<string, any>) => Promise<Record<string, any>>;
    },
  ): Promise<Array<QueryVariables>> {
    const enrollmentVariables: { program: string; dx: string[] }[] =
      (this.enrollmentAnalyticsParameters as { program: string; dx: string[] }[]) ?? [];

    if (isEmpty(enrollmentVariables)) return [];

    return mapSeries(
      enrollmentVariables,
      asyncify(async ({ program, dx }: { program: string; dx: string[] }) => {
        try {
          const params = {
            program: ensureStr(program),
            dx,
            ou: orgUnits,
            pe: periods,
            page: 1,
            pageSize: PAGE_SIZE,
            skipMeta: false,
            skipData: false,
          };
          const pagination = await this.getPagination(params, { getter: getEnrollments });
          return { params, pagination };
        } catch (e) {
          console.error(e);
          return [];
        }
      }),
    );
  }

  async getData(
    dimensions: { orgUnits: string[]; periods: string[] },
    {
      getEvents,
      getEnrollments,
      setProgress,
      setTotalRequests,
    }: {
      getEvents: (options: Record<string, any>) => Promise<Record<string, any>>;
      getEnrollments: (options: Record<string, any>) => Promise<Record<string, any>>;
      setProgress: any;
      setTotalRequests: any;
    },
  ) {
    const eventPagination = await this.getEventPaginationAndParams(dimensions, { getEvents });
    let totalPages = sumBy(eventPagination, "pagination.pageCount");

    const enrollmentPagination = await this.getEnrollmentPaginationAndParams(dimensions, {
      getEnrollments,
    });

    if (this.config.includeEnrollmentWithoutService) {
      totalPages += sumBy(enrollmentPagination, "pagination.pageCount");
    }
    setTotalRequests(totalPages);

    const pagesData = await Promise.all([
      this.getEventsData(eventPagination, { getEvents, setProgress }),
      ...(this.config.includeEnrollmentWithoutService
        ? [this.getEnrollmentData(enrollmentPagination, { getEnrollments, setProgress })]
        : []),
    ]);

    // 1. flatten everything
    let flat = flattenDeep(pagesData) as Record<string, any>[];

    // 2. per-stage any-true for boolean DEs
    flat = this.reduceBooleanEventsAnyTrue(flat);

    // 3. copy staged/raw into display-name columns
    flat = this.copyValuesToDisplayColumns(flat);

    // 4. merge duplicate display names across stages
    flat = this.mergeSameNameBooleanColumns(flat);

    // 4.5 compute is_service_provided using service-provision stages + selected period
    flat = this.enforceIsServiceProvidedByYesValue(flat, dimensions.periods);

    // 5. final guarantee: all boolean fields become Yes/No
    flat = enforceBooleanYesNo(flat, this.config.dxConfigs);

    // 6. (optional) stage-restricted reports
    const restrictedStages = STAGE_RESTRICTED_REPORTS[this.config.id];
    if (restrictedStages && restrictedStages.length) {
      flat = this.filterRowsByRequiredStages(flat, restrictedStages);
    }

    this.data = flat;
    return this;
  }

  getFormattedData(orgUnits: any[]) {
    return uniqBy(
      getFormattedEventAnalyticDataForReport(
        this.data ?? [],
        this.config,
        orgUnits,
        this.programToProgramStages,
      ),
      "id",
    );
  }

  getColumns(): CustomDataTableColumn[] {
    return uniqBy(
      this.config.dxConfigs.map((item) => {
        return {
          key: item.name,
          label: item.name,
          width: 300,
        };
      }),
      "key",
    );
  }

  private async getPagination(
    variables: {
      dx: string[];
      pe?: string[];
      ou: string[];
      program: string;
      stage?: string;
      startDate?: string;
      endDate?: string;
    },
    {
      getter,
    }: {
      getter: (options: Record<string, any>) => Promise<Record<string, any>>;
    },
  ): Promise<Pagination> {
    const response = await getter({
      ...variables,
      page: 1,
      pageSize: 1,
      skipMeta: false,
    });
    const serverPagination = (response?.data?.metaData?.pager ?? {}) as Pagination;
    return {
      ...serverPagination,
      pageSize: PAGE_SIZE,
      pageCount: Math.ceil((serverPagination.total ?? 0) / PAGE_SIZE),
    };
  }
}
