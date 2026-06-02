import React from "react";
import { LegalContentView } from "@/src/components/LegalContentView";
import { ABOUT_SECTIONS, APP_VERSION } from "@/src/content/legal";

export default function About() {
  return (
    <LegalContentView
      title="Acerca de la app"
      subtitle={`v${APP_VERSION}`}
      sections={ABOUT_SECTIONS}
    />
  );
}
