import React from "react";
import { LegalContentView } from "@/src/components/LegalContentView";
import { PRIVACY_SECTIONS, LEGAL_EFFECTIVE_DATE } from "@/src/content/legal";

export default function Privacy() {
  return (
    <LegalContentView
      title="Política de Privacidad"
      subtitle={`Vigente desde el ${LEGAL_EFFECTIVE_DATE}`}
      sections={PRIVACY_SECTIONS}
      documentVersion="1.0"
    />
  );
}
