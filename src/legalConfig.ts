const publicValue = (value: string | undefined) => value?.trim() || "";

export const legalConfig = {
  serviceName: "Life Compass",
  contactEmail: "tomo198.support@gmail.com",
  operatorName: publicValue(import.meta.env.VITE_LEGAL_OPERATOR_NAME),
  representativeName: publicValue(import.meta.env.VITE_LEGAL_REPRESENTATIVE_NAME),
  address: publicValue(import.meta.env.VITE_LEGAL_ADDRESS),
  phone: publicValue(import.meta.env.VITE_LEGAL_PHONE),
  websiteUrl: "https://life.raotomo.com",
  proPriceLabel: "月額590円（税込・予定）",
  lastUpdated: "2026年7月16日"
};

export const commercialIdentityReady = Boolean(
  legalConfig.operatorName && legalConfig.representativeName && legalConfig.address && legalConfig.phone
);

export const publicCommercialValue = (value: string) => value || "請求があった場合には遅滞なく開示いたします";
