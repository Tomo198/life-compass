import type { HouseholdMember, HouseholdMemberRelationship, Profile } from "../types";

export const LEGACY_MEMBER_IDS: Record<HouseholdMemberRelationship, string> = {
  self: "member-self",
  spouse: "member-spouse",
  child: "member-child",
  parent: "member-parent",
  other: "member-other"
};

export const householdMemberRelationshipLabels: Record<HouseholdMemberRelationship, string> = {
  self: "本人",
  spouse: "配偶者",
  child: "子ども",
  parent: "親",
  other: "その他"
};

const approximateBirthYear = (age: number) =>
  age > 0 ? new Date().getFullYear() - age : null;

const createMember = (
  relationship: HouseholdMemberRelationship,
  birthYear: number | null = null
): HouseholdMember => ({
  id: LEGACY_MEMBER_IDS[relationship],
  displayName: householdMemberRelationshipLabels[relationship],
  relationship,
  birthYear,
  birthMonth: null
});

export const createSuggestedHouseholdMembers = (
  profile: Pick<Profile, "age" | "familyType">
): HouseholdMember[] => {
  const members = [createMember("self", approximateBirthYear(profile.age))];

  if (profile.familyType === "couple") members.push(createMember("spouse"));
  if (profile.familyType === "children") members.push(createMember("child"));
  if (profile.familyType === "care") members.push(createMember("parent"));

  return members;
};
