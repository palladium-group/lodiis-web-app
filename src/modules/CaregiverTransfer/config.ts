// DHIS2 IDs — replace the placeholders with your real UIDs.
// You said your guardian relationship is bidirectional with A = OVC (Child), B = Caregiver.
// We will create links as: from = CHILD, to = CAREGIVER.

export const CAREGIVER_TRANSFER_CONFIG = {
  // RelationshipType: A = OVC (child), B = Caregiver
  REL_TYPE_GUARDIAN_OF: "UVV4IIKD73V",

  // Optional: history link A = OVC (child), B = Caregiver (previous guardian)
  REL_TYPE_PREVIOUS_GUARDIAN_OF: "QUpLoRgN56E",

  // Optional: caregiver↔caregiver link A = Old Caregiver, B = New Caregiver
  REL_TYPE_CAREGIVER_REPLACED_BY: "QUpLoRgN56E",

  // Optional: child TE attribute to store current caregiver TEI UID
  CHILD_ATTR_CURRENT_CAREGIVER_UID: "REPLACE_ME_CHILD_ATTR_UID",

  // Optional: child program UID (only if you want to attempt ownership transfer)
  CHILD_PROGRAM_UID: "REPLACE_ME_CHILD_PROGRAM",
   // NEW: Name attributes for children (set whichever you use)
  CHILD_NAME_ATTRS: {
    // If you have a single "Full name" attribute, put its UID here:
    fullName: "WTZ7GLTrE8Q",

    // Or, if you have separate first/last name attributes, put UIDs here:
    firstName: "WTZ7GLTrE8Q",
    surname: "rSP9c21JsfC",},
  } as const;
