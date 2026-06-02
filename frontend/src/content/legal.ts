/**
 * legal.ts — Contenido oficial de Términos, Privacidad, Licencias y About.
 *
 * SINGLE SOURCE OF TRUTH para los textos legales. Si actualizas el contenido
 * de T&C o Privacy, INCREMENTA `TC_VERSION` o `PRIVACY_VERSION` en
 * `backend/core/legal_versions.py` para forzar re-consentimiento del usuario.
 *
 * Idioma: español (México). Tono: claro, no-jurídico salvo donde es necesario.
 */

import Constants from "expo-constants";

export const LEGAL_ENTITY = "PadelAppRetas";
export const LEGAL_CONTACT_EMAIL = "legal@padelappretas.com";
export const LEGAL_EFFECTIVE_DATE = "30 de mayo de 2026";

export const APP_VERSION =
  Constants.expoConfig?.version ?? Constants.manifest?.version ?? "1.0.0";

export type LegalSection = {
  title: string;
  body: string;
};

/* ============================================================
   TÉRMINOS Y CONDICIONES — versión 1.0
   ============================================================ */
export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: "1. Aceptación del servicio",
    body:
      "Al crear una cuenta o usar PadelAppRetas (la “Plataforma”) aceptas " +
      "estos Términos y Condiciones. Si no estás de acuerdo con algunos de " +
      "sus puntos, debes abstenerte de usar la Plataforma.",
  },
  {
    title: "2. Descripción del servicio",
    body:
      "PadelAppRetas conecta jugadores y organizadores de torneos de pádel. " +
      "La Plataforma facilita el descubrimiento, inscripción y gestión de retas " +
      "pero NO organiza directamente los eventos, los cuales son responsabilidad " +
      "exclusiva del organizador anónimo o club que los publica.",
  },
  {
    title: "3. Registro de cuenta",
    body:
      "Para usar funcionalidades restringidas debes proporcionar un número " +
      "telefónico válido (jugador) o un email institucional (organizador). Eres " +
      "responsable de mantener la confidencialidad de tu sesión y de toda " +
      "actividad que ocurra bajo ella.",
  },
  {
    title: "4. Pagos e inscripciones",
    body:
      "Los pagos por inscripción a retas se procesan a través de Mercado Pago. " +
      "PadelAppRetas no almacena datos bancarios. Las políticas de reembolso " +
      "son responsabilidad del organizador de cada reta y deben estar visibles " +
      "en la ficha de la misma. En caso de cancelación por el organizador, el " +
      "reembolso se procesará conforme a la política indicada en la reta.",
  },
  {
    title: "5. Conducta del usuario",
    body:
      "Te comprometes a NO: (a) suplantar a otra persona; (b) abusar de " +
      "sistemas automáticos para inscribirse a múltiples retas; (c) compartir " +
      "credenciales; (d) intentar vulnerar la seguridad de la Plataforma; " +
      "(e) publicar contenido ofensivo o ilegal en chats o perfiles.",
  },
  {
    title: "6. Propiedad intelectual",
    body:
      "El código, diseño, marcas y contenido propio de PadelAppRetas pertenecen " +
      "a sus titulares. Los logotipos de clubes/torneos son propiedad de sus " +
      "respectivos dueños y se exhiben con su autorización.",
  },
  {
    title: "7. Limitación de responsabilidad y exclusión de garantías",
    body:
      "La Aplicación se proporciona \"tal cual\" y \"según disponibilidad\", sin " +
      "garantías de ningún tipo, ya sean expresas o implícitas. El Propietario no " +
      "garantiza que la aplicación sea ininterrumpida, libre de errores, segura o " +
      "que esté libre de virus u otros componentes dañinos.\n\n" +
      "En la máxima medida permitida por la ley aplicable, en ningún caso el " +
      "Propietario, sus directores, empleados o agentes serán responsables por " +
      "daños indirectos, incidentales, especiales, consecuentes o punitivos, " +
      "incluyendo, sin limitación, la pérdida de beneficios, datos, uso, fondo de " +
      "comercio u otras pérdidas intangibles que resulten de:\n\n" +
      "(i) el uso o la imposibilidad de usar la aplicación;\n" +
      "(ii) cualquier acceso no autorizado o uso de nuestros servidores y/o " +
      "cualquier información personal almacenada en ellos;\n" +
      "(iii) cualquier interrupción o cese de la transmisión hacia o desde la " +
      "aplicación;\n" +
      "(iv) cualquier error de software, virus, troyanos o similares que puedan ser " +
      "transmitidos a través de nuestra aplicación por cualquier tercero.\n\n" +
      "El usuario asume toda la responsabilidad y riesgo por el uso de la " +
      "aplicación y las interacciones o transacciones que realice a través de " +
      "ella. La responsabilidad máxima por daños atribuibles a la Plataforma se " +
      "limita al monto pagado por el usuario en los últimos 12 meses.",
  },
  {
    title: "8. Suspensión y terminación",
    body:
      "Podemos suspender o cancelar cuentas que violen estos términos, sin " +
      "reembolso de inscripciones ya jugadas. Puedes solicitar la eliminación " +
      "de tu cuenta en cualquier momento desde Configuración → Eliminar cuenta " +
      "(conforme a la directriz 5.1.1 de Apple).",
  },
  {
    title: "9. Modificaciones",
    body:
      "Podemos actualizar estos Términos. Si el cambio es sustantivo, te " +
      "solicitaremos re-aceptación antes de continuar usando la Plataforma.",
  },
  {
    title: "10. Ley aplicable y jurisdicción",
    body:
      "Estos Términos se rigen por las leyes de los Estados Unidos Mexicanos. " +
      "Cualquier controversia será sometida a los tribunales competentes de " +
      "la Ciudad de México, renunciando a cualquier otro fuero.",
  },
];

/* ============================================================
   POLÍTICA DE PRIVACIDAD — versión 1.0
   ============================================================ */
export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: "1. Responsable del tratamiento",
    body:
      `${LEGAL_ENTITY}, con dirección electrónica de contacto ${LEGAL_CONTACT_EMAIL}, ` +
      "es responsable del tratamiento de tus datos personales conforme a la " +
      "Ley Federal de Protección de Datos Personales en Posesión de los " +
      "Particulares (LFPDPPP) y, cuando aplique, al GDPR.",
  },
  {
    title: "2. Datos que recolectamos",
    body:
      "• Identificación: nombre, teléfono, email (admin), foto opcional.\n" +
      "• Ubicación aproximada (cuando autorices el GPS para encontrar retas cercanas).\n" +
      "• Datos técnicos: IP, user-agent, eventos de inicio de sesión.\n" +
      "• Histórico de inscripciones y resultados deportivos.",
  },
  {
    title: "3. Finalidades primarias",
    body:
      "(a) Operar la Plataforma y permitir tu participación en retas.\n" +
      "(b) Procesar pagos a través de Mercado Pago.\n" +
      "(c) Notificarte eventos relevantes (recordatorios, cambios).\n" +
      "(d) Detectar y prevenir fraude o uso indebido.",
  },
  {
    title: "4. Finalidades secundarias",
    body:
      "Métricas agregadas y anónimas para mejorar la app. Puedes oponerte a " +
      "este tratamiento escribiendo a " + LEGAL_CONTACT_EMAIL + ".",
  },
  {
    title: "5. Transferencias",
    body:
      "Compartimos datos mínimos con: Mercado Pago (proceso de pagos), " +
      "Twilio (envío de OTP por WhatsApp/SMS), proveedores de infraestructura " +
      "cloud. Ningún dato se vende a terceros con fines publicitarios.",
  },
  {
    title: "6. Derechos ARCO",
    body:
      "Tienes derecho a Acceder, Rectificar, Cancelar u Oponerte al uso de tus " +
      "datos. Puedes ejercer estos derechos escribiendo a " + LEGAL_CONTACT_EMAIL + " " +
      "o desde la app en Configuración → Eliminar cuenta.",
  },
  {
    title: "7. Seguridad",
    body:
      "Aplicamos cifrado en tránsito (HTTPS), almacenamiento seguro de tokens " +
      "en Keychain (iOS) / Keystore (Android), JWT de corta vida (15 min), " +
      "rotación de refresh tokens, lockout anti-brute-force y registro de auditoría.",
  },
  {
    title: "8. Conservación",
    body:
      "Conservamos tus datos mientras tu cuenta esté activa. Tras eliminar tu " +
      "cuenta, los datos personales son anonimizados de forma IRREVERSIBLE " +
      "(conforme a Apple 5.1.1), conservando únicamente los datos mínimos " +
      "necesarios para integridad de torneos históricos.",
  },
  {
    title: "9. Menores de edad",
    body:
      "La Plataforma está dirigida a usuarios mayores de 13 años. Menores de " +
      "edad deben contar con autorización de padre/madre/tutor.",
  },
  {
    title: "10. Cambios en esta política",
    body:
      "Notificaremos cambios sustantivos. La fecha de última actualización " +
      "aparece en el encabezado de este documento.",
  },
];

/* ============================================================
   LICENCIAS OPEN SOURCE
   ============================================================ */
export const LICENSES_SECTIONS: LegalSection[] = [
  {
    title: "React Native (MIT)",
    body: "Copyright © Meta Platforms, Inc. — Licencia MIT.",
  },
  {
    title: "Expo (MIT)",
    body: "Copyright © Expo — Licencia MIT.",
  },
  {
    title: "FastAPI (MIT)",
    body: "Copyright © Sebastián Ramírez — Licencia MIT.",
  },
  {
    title: "MongoDB Node Driver (Apache 2.0)",
    body: "Copyright © MongoDB Inc. — Apache License 2.0.",
  },
  {
    title: "react-native-reanimated (MIT)",
    body: "Copyright © Software Mansion — Licencia MIT.",
  },
  {
    title: "lucide-react-native (ISC)",
    body: "Copyright © Lucide Contributors — Licencia ISC.",
  },
  {
    title: "Mercado Pago SDK (propietario)",
    body: "© Mercado Pago. Uso bajo términos de su API pública.",
  },
  {
    title: "Twilio SDK (propietario)",
    body: "© Twilio Inc. Uso bajo términos de su API pública.",
  },
  {
    title: "Y muchas más…",
    body:
      "Esta lista incluye las dependencias más relevantes. El detalle completo " +
      "de licencias está disponible en el repositorio del proyecto.",
  },
];

/* ============================================================
   ACERCA DE / DISCLAIMER
   ============================================================ */
export const ABOUT_SECTIONS: LegalSection[] = [
  {
    title: "Versión",
    body: `Versión ${APP_VERSION} — Build: ${LEGAL_EFFECTIVE_DATE}`,
  },
  {
    title: "Compañía",
    body: `${LEGAL_ENTITY} © ${new Date().getFullYear()}. Todos los derechos reservados.`,
  },
  {
    title: "Contacto",
    body: `Soporte y consultas legales: ${LEGAL_CONTACT_EMAIL}`,
  },
  {
    title: "Aviso",
    body:
      "PadelAppRetas no es responsable de lesiones, accidentes o disputas " +
      "durante las retas. Cada usuario participa bajo su propio riesgo y " +
      "debe contar con el equipo y condición física adecuados. Para emergencias " +
      "médicas, contacta a los servicios locales (911 en México).",
  },
];
