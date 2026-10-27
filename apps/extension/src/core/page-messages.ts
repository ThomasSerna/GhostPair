import type { Locale } from '@ghostpair/protocol';

const spanish = {
  'Preview changes': 'Vista previa de cambios',
  'Full control': 'Control total',
  'Clicks and typing are previews. Scrolling, navigation and tab management still change the shared page.': 'Los clics y la escritura son vistas previas. Desplazarse, navegar y administrar pestañas sí modifica la página compartida.',
  'Actions change the page. Hiding feedback keeps these changes visible.': 'Las acciones modifican la página. Ocultar las indicaciones no oculta esos cambios.',
  'Page sharing controls': 'Controles de la página compartida',
  'Interaction mode': 'Modo de interacción',
  'Show their actions': 'Mostrar sus acciones',
  'Show where they click': 'Mostrar dónde hacen clic',
  'Hide panel': 'Ocultar panel',
  'Show it again from the GhostPair extension menu.': 'Puedes volver a mostrarlo desde el menú de la extensión GhostPair.',
  'GhostPair previews': 'Vistas previas de GhostPair',
  'Typing preview': 'Vista previa de escritura',
  'Click preview': 'Vista previa de clic',
  'Preview': 'Vista previa',
  'text': 'texto',
  'Could not update page controls. Try again.': 'No se pudieron actualizar los controles de la página. Inténtalo de nuevo.',
  'Could not configure the shared page. Try again.': 'No se pudo configurar la página compartida. Inténtalo de nuevo.',
  'The shared page changed. Try again.': 'La página compartida cambió. Inténtalo de nuevo.',
  'The interaction mode changed.': 'El modo de interacción cambió.',
  'Only the host can change the interaction mode.': 'Solo quien comparte puede cambiar el modo de interacción.',
  'Only the host can change interaction visibility.': 'Solo quien comparte puede cambiar la visibilidad de las interacciones.',
  'Only the host can change simulation preferences.': 'Solo quien comparte puede cambiar las preferencias de las vistas previas.',
  'Only the host can change the simulation.': 'Solo quien comparte puede cambiar las vistas previas.',
  'Invalid visibility preference.': 'La preferencia de visibilidad no es válida.',
};

export type PageMessage = keyof typeof spanish;
export interface PageMessages { locale: Locale; translations: Partial<Record<PageMessage, string>> }
const english = Object.fromEntries(Object.keys(spanish).map(message => [message, message]));

export function pageMessages(locale: Locale): PageMessages {
  return { locale, translations: locale === 'es' ? spanish : english };
}
