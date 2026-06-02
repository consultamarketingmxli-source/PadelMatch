import React from "react";
import { LegalContentView } from "@/src/components/LegalContentView";
import { LICENSES_SECTIONS } from "@/src/content/legal";

export default function Licenses() {
  return (
    <LegalContentView
      title="Licencias Open Source"
      subtitle="Bibliotecas de terceros"
      sections={LICENSES_SECTIONS}
    />
  );
}
