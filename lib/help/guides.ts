/**
 * Help & guides registry: one entry per guide under /help/<slug>. Add a guide
 * by writing its content module next to this file and listing it here.
 */
import { USER_GUIDE_HTML, USER_GUIDE_TOC } from './userGuideFa';

export type HelpGuide = {
  slug: string;
  /** Key under `help` in messages/*.json holding `title` + `description`. */
  messageKey: 'userGuide';
  /** Language of the content; the page renders it in that language for every locale. */
  lang: 'fa' | 'en';
  html: string;
  toc: { id: string; level: 2 | 3; text: string }[];
  pdf?: string;
};

export const HELP_GUIDES: HelpGuide[] = [
  {
    slug: 'user-guide',
    messageKey: 'userGuide',
    lang: 'fa',
    html: USER_GUIDE_HTML,
    toc: USER_GUIDE_TOC,
    pdf: '/help/BJ-HR-SOP-fa.pdf',
  },
];

export function findGuide(slug: string): HelpGuide | undefined {
  return HELP_GUIDES.find((g) => g.slug === slug);
}
