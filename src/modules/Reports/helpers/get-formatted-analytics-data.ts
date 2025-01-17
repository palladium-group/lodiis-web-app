import * as _ from "lodash";
import { evaluationOfPrimaryPackageCompletionAtLeastOneSecondary } from "./primary-package-completion-at-least-secondary-helper";
import { evaluationOfPrimaryPackageCompletion } from "./primary-package-completion-helper";
import { evaluationOfSecondaryPrimaryPackageCompletion } from "./secondary-primary-package-completion-helper";
import { CombineValues } from "../../../shared/interfaces/report";
import {
	evaluateServiceCompletionForCodes,
	serviceTotalSessions,
} from "./get-average-session-number-per-intervention";
import { DEFAULT_ANALYTICS_KEYS } from "../../../constants/reports";

export function getSanitizesReportValue(
	value: any,
	codes: Array<string> = [],
	isBoolean: boolean,
	isDate: boolean,
	displayValues: Array<any>,
	skipSanitizationOfDisplayName: boolean,
	analyticDataByBeneficiary: any[],
	programStage: string,
) {
	const displayNames = _.flattenDeep(
		_.map(displayValues || [], (displayValue) => displayValue.displayName),
	);
	displayNames.push("Yes", "1");
	let sanitizedValue = "";
	// Checks if any individual code requires session count validation
	const requiresSessionValidation = codes.some((code) =>
		serviceTotalSessions.hasOwnProperty(code),
	);

	// Special combination check
	const isSpecificCombination =
		codes.includes("Go Girls") &&
		codes.includes("AFLATEEN/TOUN") &&
		codes.length === 2;

	if (
		codes &&
		codes.length > 0 &&
		!requiresSessionValidation &&
		!isSpecificCombination
	) {
		sanitizedValue =
			codes.includes(value) || displayNames.includes(value)
				? "Yes"
				: sanitizedValue;
	} else if (requiresSessionValidation || isSpecificCombination) {
		sanitizedValue = evaluateServiceCompletionForCodes(
			analyticDataByBeneficiary,
			programStage,
			codes,
		);
	} else if (isBoolean) {
		sanitizedValue = displayNames.includes(`${value}`)
			? "Yes"
			: sanitizedValue;
	} else if (isDate) {
		sanitizedValue = getFormattedDate(value);
	} else {
		sanitizedValue = value;
	}
	return displayValues && displayValues.length > 0
		? getSanitizedDisplayValue(
				sanitizedValue,
				displayValues,
				skipSanitizationOfDisplayName,
			)
		: sanitizedValue;
}

export function getValueFromCombinedDataValues(
	analyticDataByBeneficiary: any[],
	ids: string[],
	combineValues: CombineValues,
	programStage: string,
): string {
	let value = "";

	const filteredAnalyticDataByBeneficiary = _.filter(
		analyticDataByBeneficiary,
		({ programStage: programStageId }) => programStageId === programStage,
	);

	for (const analyticsData of filteredAnalyticDataByBeneficiary) {
		value = _.every(ids, (id) => {
			const requiredValue = _.find(
				combineValues.dataValues,
				({ id: dataElement }) => dataElement === id,
			)?.value;

			return requiredValue && requiredValue === analyticsData[id];
		})
			? combineValues.displayValue
			: value;
	}
	return value;
}

export function getSanitizedDisplayValue(
	sanitizedValue: string,
	displayValues: any,
	skipSanitizationOfDisplayName: boolean,
) {
	const valueObject = _.find(displayValues || [], (displayValue: any) => {
		return _.isEqual(
			displayValue.value.toLowerCase(),
			sanitizedValue.toLowerCase(),
		);
	});
	const sanitizedDisplayName =
		valueObject && !skipSanitizationOfDisplayName
			? valueObject.displayName
			: sanitizedValue;
	return sanitizedDisplayName;
}

export function getFormattedDate(date: any) {
	let dateObject = new Date(date);
	if (isNaN(dateObject.getDate())) {
		dateObject = new Date();
	}
	const day = dateObject.getDate();
	const month = dateObject.getMonth() + 1;
	const year = dateObject.getFullYear();
	return (
		year +
		(month > 9 ? `-${month}` : `-0${month}`) +
		(day > 9 ? `-${day}` : `-0${day}`)
	);
}

const districtLevel = 2;
const communityCouncilLevel = 3;
const facilityLevel = 4;

const noneAgywParticipationProgramStages = ["uctHRP6BBXP"];
const noneAgywDreamBeneficairiesStage = ["Yn6AJ0CAxb2"];
const prepVisitProgramStages = ["nVCqxOg0nMQ", "Yn6AJ0CAxb2"];
const beneficiaryDateOfBirthReference = ["qZP982qpSPS", "jVSwC6Ln95H"];
const primaryChildCheckReference = "KO5NC4pfBmv";
const casePlanProgramStages = ["gkNKXUxpyv9", "vjF07cZNST3"];
const lastIpProvideService = "lcyyWZnfQNJ";
const lastServiceProvider = "GsWaSx1t3Qs";

const enrolledIp = "klLkGxy328c";
const enrolledServiceProvider = "DdnlE8kmIkT";
export const defaultPrepVisitKey = "Follow up Visit";

function getAssessmentDate(analyticDataByBeneficiary: Array<any>) {
	let date = "";
	for (const programStage of casePlanProgramStages) {
		const serviceData: any = getLastServiceFromAnalyticData(
			analyticDataByBeneficiary,
			programStage,
		);

		if (_.keys(serviceData).length > 0) {
			date =
				serviceData && _.keys(serviceData).length > 0
					? serviceData["eventdate"] || date
					: date;
		}
	}
	return date;
}

function _isBenediciaryScreenedForPrep(
	ids: string[],
	analyticDataByBeneficiary: any,
) {
	var isScreenedForPrep = false;
	for (var beneficairyData of analyticDataByBeneficiary) {
		for (const id of ids) {
			if (_.keys(beneficairyData).includes(id)) {
				const value = beneficairyData[id] ?? "";
				if (`${value}`.trim() !== "") {
					isScreenedForPrep = true;
				}
			}
		}
	}
	return isScreenedForPrep;
}

function getFollowingUpVisits(analyticDataByBeneficiary: any) {
	const followingUpVisits: any = {};
	const visitDates = _.reverse(
		_.map(
			_.sortBy(
				_.filter(analyticDataByBeneficiary, (beneficiaryData: any) => {
					const programStageId =
						beneficiaryData["programStage"] || "";
					return prepVisitProgramStages.includes(programStageId);
				}),
				["eventdate"],
			),
			(beneficiaryData: any) =>
				getFormattedDate(beneficiaryData["eventdate"]),
		),
	);
	let visitIndex = 0;
	for (const visitDate of visitDates) {
		visitIndex++;
		const key = `${defaultPrepVisitKey} ${visitIndex}`;
		followingUpVisits[key] = visitDate;
	}
	return followingUpVisits;
}

function isBeneficiaryEligibleForPrep(
	ids: any,
	analyticDataByBeneficiary: any,
) {
	const dataObj: any = {};
	for (const id of ids) {
		dataObj[id] = "1";
	}
	for (const beneficairyData of analyticDataByBeneficiary) {
		for (const id of ids) {
			const value = beneficairyData[id] ?? "";
			if (!["Yes", "true", "1"].includes(`${value}`)) {
				dataObj[id] = "0";
			}
		}
	}
	return _.uniq(_.values(dataObj)).includes("0") ? "No" : "Yes";
}

function getPrepBeneficiaryStatus(analyticDataByBeneficiary: any) {
	const prepVisits = _.filter(analyticDataByBeneficiary, (data: any) => {
		const programStageId = data["programStage"];
		return prepVisitProgramStages.includes(programStageId);
	});
	return prepVisits.length == 1
		? "PrEP New"
		: prepVisits.length > 1
			? "PrEP Continue"
			: "";
}

function getLastServiceFromAnalyticData(
	analyticDataByBeneficiary: Array<any>,
	programStage: string,
) {
	let lastService: any = {};
	const sortedServices = _.reverse(
		_.sortBy(
			_.filter(
				programStage && programStage !== ""
					? _.filter(
							analyticDataByBeneficiary,
							(data: any) =>
								data.programStage &&
								data.programStage === programStage,
						)
					: analyticDataByBeneficiary,
				(data: any) => data && data["eventdate"] !== undefined,
			),
			["eventdate"],
		),
	);
	if (sortedServices.length > 0) {
		lastService = { ...lastService, ...sortedServices[0] };
	}
	return lastService;
}

function getLongFormPrEPValue(
	analyticsDataByBeneficiary: Array<any>,
	prepFields: Array<string>,
	programStage: string,
): string {
	const programStageData = _.find(
		analyticsDataByBeneficiary || [],
		(data: any) => {
			return data.programStage && data.programStage === programStage;
		},
	);

	if (programStageData) {
		for (const field of prepFields) {
			if (
				!(field in programStageData) ||
				programStageData[field] !== "1"
			) {
				return "0";
			}
		}
	} else {
		return "0";
	}
	return "1";
}

function getLocationNameByLevel(
	analyticDataByBeneficiary: Array<any>,
	locations: Array<any>,
	level: any,
) {
	const ouIds = _.uniq(
		_.flattenDeep(
			_.map(analyticDataByBeneficiary, (data) => data.ou || []),
		),
	);
	const locationId = ouIds.length > 0 ? ouIds[0] : "";
	return getLocationNameByIdAndLevel(locations, level, locationId);
}

function getLocationNameByIdAndLevel(
	locations: Array<any>,
	level: number,
	locationId: string,
) {
	let locationName = "";
	const locationObj = _.find(
		locations,
		(data: any) => data && data.id && data.id === locationId,
	);
	if (level === locationObj?.level) {
		locationName = locationObj.name || locationName;
	} else if (locationObj && locationObj.ancestors) {
		const location = _.find(
			locationObj.ancestors || [],
			(data: any) => data && data.level === level,
		);
		locationName = location ? location.name || locationName : locationName;
	}
	return locationName;
}

function getBeneficiaryAge(dob: string) {
	let ageDifMs = Date.now() - new Date(dob).getTime();
	let ageDate = new Date(ageDifMs);
	return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function getValueFromAnalyticalData(
	analyticData: Array<any>,
	ids: string[],
	programStage: string,
) {
	let value = "";
	for (const data of _.filter(
		analyticData || [],
		(dataObjet: any) =>
			!dataObjet.programStage ||
			dataObjet?.programStage === programStage ||
			programStage === "",
	)) {
		for (const id of ids) {
			value = id in data && `${data[id]}` !== "" ? data[id] : value;
		}
	}
	return value;
}

function getBeneficiaryAgeRanges(age: number) {
	let value =
		age < 1
			? ""
			: age >= 1 && age < 5
				? "1-4"
				: age < 10
					? "5-9"
					: age < 15
						? "10-14"
						: age < 18
							? "15-17"
							: age < 21
								? "18-20"
								: "20+";
	return value;
}

function getBeneficiaryAgeRange(age: number): string {
	return age < 18 ? "0-17" : "18+";
}

function getBeneficiaryHivRiskAssessmentResult(
	ids: any,
	analyticDataByBeneficiary: any,
) {
	let riskValue = "";
	for (const referenceId of ids || []) {
		const referenceValue = getValueFromAnalyticalData(
			analyticDataByBeneficiary,
			beneficiaryDateOfBirthReference,
			referenceId,
		);
		if (
			`${referenceValue}`.toLocaleLowerCase() === "yes" ||
			`${referenceValue}`.toLocaleLowerCase() === "1" ||
			`${referenceValue}`.toLocaleLowerCase() === "true"
		) {
			riskValue = "High risk";
		} else {
			riskValue =
				riskValue === "High risk" || riskValue === ""
					? riskValue
					: "Low risk";
		}
	}
	return riskValue;
}

function getBeneficiaryTypeValue(
	analyticDataByBeneficiary: any,
	programToProgramStageObject: any,
) {
	let beneficiaryType = "";
	const eventProgramStages = _.compact(
		_.uniq(
			_.flattenDeep(
				_.map(analyticDataByBeneficiary || [], (data: any) =>
					data && "programStage" in data ? data.programStage : [],
				),
			),
		),
	);

	let beneficiaryProgramId = "";
	if (eventProgramStages.length > 0) {
		const stageId = eventProgramStages[0];
		for (const programId of _.keys(programToProgramStageObject)) {
			const programStages = _.map(
				programToProgramStageObject[programId],
				({ id }) => id,
			);
			if (programStages.includes(stageId)) {
				beneficiaryProgramId = programId;
			}
		}
	}

	const isBeneficiaryPrimaryChild = getValueFromAnalyticalData(
		analyticDataByBeneficiary,
		[primaryChildCheckReference],
		"",
	);

	if (beneficiaryProgramId === "BNsDaCclOiu") {
		beneficiaryType = "Caregiver";
	} else if (beneficiaryProgramId === "em38qztTI8s") {
		beneficiaryType =
			`${isBeneficiaryPrimaryChild}`.toLowerCase() === "true" ||
			`${isBeneficiaryPrimaryChild}`.toLowerCase() === "1"
				? "Primary Child"
				: "Child";
	} else if (beneficiaryProgramId === "") {
		beneficiaryType =
			isBeneficiaryPrimaryChild === ""
				? "Caregiver"
				: `${isBeneficiaryPrimaryChild}`.toLowerCase() === "true" ||
					  `${isBeneficiaryPrimaryChild}`.toLowerCase() === "1"
					? "Primary Child"
					: "Child";
	}

	return beneficiaryType;
}

function getBeneficiaryCodeValue(analyticDataByBeneficiary: any) {
	let beneficiaryCode = "";
	const id = "eIU7KMx4Tu3";

	for (const data of analyticDataByBeneficiary) {
		if (data && data[id]) {
			beneficiaryCode = data[id];
			break;
		}
	}
	if (beneficiaryCode) {
		beneficiaryCode = beneficiaryCode.slice(0, -1);
	}

	return beneficiaryCode;
}

export function getServiceFromReferral(
	analyticsDataByBeneficiary: Array<any>,
	programStage: string,
	codes: string[],
): string {
	const programStageData = _.find(
		analyticsDataByBeneficiary || [],
		(data: any) => {
			return data.programStage && data.programStage === programStage;
		},
	);
	if (programStageData) {
		const communityServiceField = "rsh5Kvx6qAU";
		const facilityServiceField = "OrC9Bh2bcFz";
		const serviceProvidedField = "hXyqgOWZ17b";
		if (
			`${programStageData[serviceProvidedField]}` === "1" &&
			[communityServiceField, facilityServiceField].some(
				(referralService: string) => {
					return codes.includes(programStageData[referralService]);
				},
			)
		) {
			return "Yes";
		} else {
			return "No";
		}
	} else {
		return "No";
	}
}

export function getFormattedEventAnalyticDataForReport(
	analyticData: Array<any>,
	reportConfig: any,
	locations: any,
	programToProgramStageObject: any,
) {
	const groupedAnalyticDataByBeneficiary = _.groupBy(analyticData, "tei");
	return _.map(
		_.flattenDeep(
			_.map(_.keys(groupedAnalyticDataByBeneficiary), (tei: string) => {
				const analyticDataByBeneficiary =
					groupedAnalyticDataByBeneficiary[tei];
				const isNotAgywBeneficiary =
					_.filter(
						_.uniq(
							_.flatMapDeep(
								_.map(
									analyticDataByBeneficiary,
									(data: any) => data.programStage ?? "",
								),
							),
						),
						(stage: string) =>
							noneAgywParticipationProgramStages.includes(
								stage,
							) ||
							noneAgywDreamBeneficairiesStage.includes(stage),
					).length > 0;
				let beneficiaryData: any = {};

				for (const dxConfigs of reportConfig.dxConfigs || []) {
					const {
						id,
						ids,
						name,
						programStage,
						isBoolean,
						codes,
						isDate,
						displayValues,
						programStages,
						combinedValues,
					} = dxConfigs;
					let value = "";
					if (id === "total_services") {
						const totalServices = _.uniq(
							_.map(
								_.filter(analyticDataByBeneficiary, (data) => {
									return (
										data[DEFAULT_ANALYTICS_KEYS.PSI] !==
										undefined
									);
								}),
								(data) => data[DEFAULT_ANALYTICS_KEYS.PSI],
							),
						).length;
						value = `${totalServices}`;
					} else if (id === lastServiceProvider) {
						const lastService: any = getLastServiceFromAnalyticData(
							analyticDataByBeneficiary,
							programStage,
						);
						value =
							lastService && _.keys(lastService).length > 0
								? lastService[lastServiceProvider] ||
									lastService[enrolledServiceProvider] ||
									value
								: value;
					} else if (id === lastIpProvideService) {
						const lastService: any = getLastServiceFromAnalyticData(
							analyticDataByBeneficiary,
							programStage,
						);

						value =
							lastService && _.keys(lastService).length > 0
								? lastService[lastIpProvideService] ||
									lastService[enrolledIp] ||
									value
								: value;
					} else if (id === "completed_primary_package") {
						value = evaluationOfPrimaryPackageCompletion(
							analyticDataByBeneficiary,
							programStages,
						);
					} else if (id === "completed_secondary_package") {
						value = evaluationOfSecondaryPrimaryPackageCompletion(
							analyticDataByBeneficiary,
							programStages,
						);
					} else if (
						id === "completed_primary_package_and_atleast_secondary"
					) {
						value =
							evaluationOfPrimaryPackageCompletionAtLeastOneSecondary(
								analyticDataByBeneficiary,
								programStages,
							);
					} else if (id === "district_of_residence") {
						const ouIds = _.uniq(
							_.flattenDeep(
								_.map(analyticDataByBeneficiary, (dataObj) =>
									_.keys(dataObj).length > 0
										? dataObj["ou"] || ""
										: "",
								),
							),
						);
						value = getLocationNameByIdAndLevel(
							locations,
							districtLevel,
							ouIds.length > 0 ? ouIds[0] : value,
						);
					} else if (id === "community_council_of_residence") {
						const ouIds = _.uniq(
							_.flattenDeep(
								_.map(analyticDataByBeneficiary, (dataObj) =>
									_.keys(dataObj).length > 0
										? dataObj["ou"] || ""
										: "",
								),
							),
						);
						value = getLocationNameByIdAndLevel(
							locations,
							communityCouncilLevel,
							ouIds.length > 0 ? ouIds[0] : value,
						);
					} else if (id === "is_eligible_for_prep") {
						value = isBeneficiaryEligibleForPrep(
							ids,
							analyticDataByBeneficiary,
						);
					} else if (id === "is_screened_for_prep") {
						var isScreenedForPrep = _isBenediciaryScreenedForPrep(
							ids,
							analyticDataByBeneficiary,
						);
						value = isScreenedForPrep ? "Yes" : "No";
					} else if (id === "prep_beneficairy_status") {
						value = getPrepBeneficiaryStatus(
							analyticDataByBeneficiary,
						);
					} else if (id === "assessmment_date") {
						const assessmentDate = getAssessmentDate(
							analyticDataByBeneficiary,
						);
						value = `${assessmentDate}`.split(" ")[0];
					} else if (id === "is_assemmenet_conducted") {
						const assessmentDate = getAssessmentDate(
							analyticDataByBeneficiary,
						);
						value = assessmentDate === "" ? "No" : "Yes";
					} else if (id === "hiv_risk_assessment_result") {
						value = getBeneficiaryHivRiskAssessmentResult(
							ids,
							analyticDataByBeneficiary,
						);
					} else if (id === "beneficiary_age") {
						const dob = getValueFromAnalyticalData(
							analyticDataByBeneficiary,
							beneficiaryDateOfBirthReference,
							programStage,
						);
						if (dob !== "") {
							const age = getBeneficiaryAge(dob);
							value = `${age}`;
						}
					} else if (id === "beneficiary_age_range") {
						const dob = getValueFromAnalyticalData(
							analyticDataByBeneficiary,
							beneficiaryDateOfBirthReference,
							programStage,
						);
						if (dob !== "") {
							const age = getBeneficiaryAge(dob);
							value = getBeneficiaryAgeRange(age);
						}
					} else if (id === "beneficiary_age_ranges") {
						const dob = getValueFromAnalyticalData(
							analyticDataByBeneficiary,
							beneficiaryDateOfBirthReference,
							programStage,
						);
						if (dob !== "") {
							const age = getBeneficiaryAge(dob);
							value = getBeneficiaryAgeRanges(age);
						}
					} else if (id === "household_id") {
						value = getBeneficiaryCodeValue(
							analyticDataByBeneficiary,
						);
					} else if (id === "beneficiary_type") {
						value = getBeneficiaryTypeValue(
							analyticDataByBeneficiary,
							programToProgramStageObject,
						);
					} else if (id === "prep_from_long_form") {
						value = getLongFormPrEPValue(
							analyticDataByBeneficiary,
							ids,
							programStage,
						);
					} else if (id === "is_service_provided") {
						const lastService = getLastServiceFromAnalyticData(
							analyticDataByBeneficiary,
							programStage,
						);
						value =
							lastService && _.keys(lastService).length > 0
								? "Yes"
								: value === ""
									? ""
									: "No";
					}
					if (id === "last_service_community_council") {
						const lastService: any = getLastServiceFromAnalyticData(
							analyticDataByBeneficiary,
							programStage,
						);
						const locationId =
							lastService && _.keys(lastService).length > 0
								? lastService["ou"] || ""
								: "";
						value = getLocationNameByIdAndLevel(
							locations,
							communityCouncilLevel,
							locationId,
						);
					} else if (id === "facility_name") {
						value = getLocationNameByLevel(
							analyticDataByBeneficiary,
							locations,
							facilityLevel,
						);
					} else if (id === "district_of_service") {
						value = getLocationNameByLevel(
							analyticDataByBeneficiary,
							locations,
							districtLevel,
						);
					} else if (id === "service_from_referral") {
						value = getServiceFromReferral(
							analyticDataByBeneficiary,
							programStage,
							codes,
						);
					} else if (id === "date_of_last_service_received") {
						const lastService: any = getLastServiceFromAnalyticData(
							analyticDataByBeneficiary,
							programStage,
						);
						value =
							lastService && _.keys(lastService).length > 0
								? lastService["eventdate"] || value
								: value;
					} else if (id === "date_case_plan") {
						const lastService: any = getLastServiceFromAnalyticData(
							analyticDataByBeneficiary,
							programStage,
						);
						value =
							lastService && _.keys(lastService).length > 0
								? lastService["eventdate"] || value
								: value;
					} else if (id === "isAgywBeneficiary") {
						value = !isNotAgywBeneficiary ? "Yes" : "No";
					} else if (ids && combinedValues) {
						value = getValueFromCombinedDataValues(
							analyticDataByBeneficiary,
							ids,
							combinedValues,
							programStage,
						);
					} else {
						// Take consideration of services codes
						const eventReportData =
							id !== "" && programStage === ""
								? _.find(
										analyticDataByBeneficiary,
										(data: any) => {
											return codes && codes.length > 0
												? _.keys(data).includes(id) &&
														codes.includes(data[id])
												: _.keys(data).includes(id);
										},
									)
								: _.find(
										analyticDataByBeneficiary,
										(data: any) => {
											return codes && codes.length > 0
												? _.keys(data).includes(id) &&
														codes.includes(
															data[id],
														) &&
														data.programStage &&
														data.programStage ===
															programStage
												: _.keys(data).includes(id) &&
														data.programStage &&
														data.programStage ===
															programStage;
										},
									);
						value = eventReportData ? eventReportData[id] : value;
					}
					if (id === "following_up_visit") {
						const followingUpVisits = getFollowingUpVisits(
							analyticDataByBeneficiary,
						);
						beneficiaryData = {
							...beneficiaryData,
							...followingUpVisits,
						};
					} else {
						if (
							_.keys(beneficiaryData).includes(name) &&
							beneficiaryData[name] !== ""
						) {
							value = beneficiaryData[name];
						}
						beneficiaryData[name] =
							value !== ""
								? getSanitizesReportValue(
										value,
										codes,
										isBoolean,
										isDate,
										displayValues,
										isNotAgywBeneficiary,
										analyticDataByBeneficiary,
										programStage,
									)
								: getSanitizedDisplayValue(
										value,
										displayValues,
										isNotAgywBeneficiary,
									);
					}
				}
				const totalNumberOfServices = _.find(
					reportConfig.dxConfigs,
					(config: any) => config.id === "total_services",
				);
				return { ...beneficiaryData, id: tei };
			}),
		),
		(beneficiary: any) => {
			const enrolledServiceProvider =
				beneficiary["Enrolled Service Provider"] || "";
			const serviceProvider = beneficiary["Last Service Provider"] || "";
			if (enrolledServiceProvider === "scriptrunner") {
				beneficiary["Enrolled Service Provider"] = "UPLOADED";
				beneficiary["Enrolled IP"] = "";
				if (_.keys(beneficiary).includes("Enrolled Sub IP")) {
					beneficiary["Enrolled Sub IP"] = "";
				}
			}
			if (serviceProvider === "scriptrunner") {
				beneficiary["Last Service Provider"] = "UPLOADED";
				beneficiary["Last IP provide service"] = "";
			}
			return beneficiary;
		},
	);
}
