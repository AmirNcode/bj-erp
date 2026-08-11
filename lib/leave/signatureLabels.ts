import type { SignatureLabels } from './signature';

/** Builds shared signature copy, with a role-specific title when requested. */
export function signatureLabelsFrom(
  t: (key: string) => string,
  titleKey: 'title' | 'requesterTitle' | 'approverTitle' = 'title'
): SignatureLabels {
  return {
    title: t(titleKey),
    instructions: t('instructions'),
    clear: t('clear'),
    authorization: t('authorization'),
    validationSignature: t('validationSignature'),
    validationAuthorization: t('validationAuthorization'),
    canvasLabel: t('canvasLabel'),
    view: t('view'),
    hide: t('hide'),
    loading: t('loading'),
    authorizedAt: t('authorizedAt'),
  };
}
