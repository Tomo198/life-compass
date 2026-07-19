const normalizeSubject = (value) => typeof value === "string" ? value.trim() : "";

export const isOwnerTestUser = (user, env) => {
  const ownerSubject = normalizeSubject(env?.OWNER_GOOGLE_SUB);
  return Boolean(
    ownerSubject
    && user?.emailVerified
    && normalizeSubject(user.googleSub) === ownerSubject
  );
};
