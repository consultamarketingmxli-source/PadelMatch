import React from "react";
import { LegalContentView } from "@/src/components/LegalContentView";
import { TERMS_SECTIONS, LEGAL_EFFECTIVE_DATE } from "@/src/content/legal";

export default function Terms() {
  return (
    <LegalContentView
      title="Términos y Condiciones"
      subtitle={`Vigente desde el ${LEGAL_EFFECTIVE_DATE}`}
      sections={TERMS_SECTIONS}
      documentVersion="1.0"
    />
  );
}
