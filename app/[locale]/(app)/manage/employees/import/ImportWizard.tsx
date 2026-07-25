'use client';

import { useState } from 'react';
import { parseCsv, buildCsv } from '@/lib/csv/parse';
import {
  IMPORT_COLUMNS,
  templateHeader,
  validateImportRows,
  type ImportRow,
  type RowError,
} from '@/lib/csv/import-rows';
import {
  bulkCreateEmployees,
  type IssuedCredential,
} from '@/lib/actions/employees';
import { CredentialsDownload } from '@/components/CredentialsDownload';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Department = { name_fa: string; name_en: string; code: string };

type Props = {
  departments: Department[];
  existingPersonnelNos: string[];
  locale: string;
  labels: {
    intro: string;
    template: string;
    templateHint: string;
    upload: string;
    rowsValid: string;
    rowsInvalid: string;
    line: string;
    problem: string;
    import: string;
    importing: string;
    errorLabel: string;
    errors: Record<RowError['messageKey'], string>;
    credentials: {
      title: string;
      warn: string;
      download: string;
      name: string;
      code: string;
      password: string;
    };
  };
};

export function ImportWizard({ departments, existingPersonnelNos, locale, labels }: Props) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [fileLoaded, setFileLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<IssuedCredential[] | null>(null);

  const downloadTemplate = () => {
    const blob = new Blob([buildCsv([templateHeader()])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bj-employees-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setServerError(null);
    const text = await file.text();
    const result = validateImportRows(parseCsv(text), {
      deptCodes: departments.map((d) => d.code),
      existingPersonnelNos,
    });
    setRows(result.rows);
    setErrors(result.errors);
    setFileLoaded(true);
  };

  const runImport = async () => {
    setPending(true);
    setServerError(null);
    const result = await bulkCreateEmployees(rows);
    setPending(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setCredentials(result.credentials);
  };

  if (credentials) {
    return <CredentialsDownload credentials={credentials} labels={labels.credentials} />;
  }

  return (
    <div className="space-y-6">
      {/* Stage 1 — template + on-screen example */}
      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{labels.intro}</p>
          <Button variant="outline" onClick={downloadTemplate} data-testid="template-download">
            {labels.template}
          </Button>
          <p className="text-sm text-muted-foreground">{labels.templateHint}</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40">
                <tr>
                  {IMPORT_COLUMNS.map((c) => (
                    <th key={c.key} className="text-start px-2 py-1.5 font-semibold whitespace-nowrap">
                      {c.labelFa}
                      {c.required && <span className="text-destructive"> *</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="text-muted-foreground">
                  {['رضا کریمی', '1042', '1404/04/22', departments[0]?.code ?? 'prod', '', 'manager', 'سرپرست خط', '26', '10'].map(
                    (v, i) => (
                      <td key={i} className="px-2 py-1.5 whitespace-nowrap" dir="auto">{v}</td>
                    )
                  )}
                </tr>
                <tr className="text-muted-foreground">
                  {['علی رضایی', '1043', '1404/04/22', departments[0]?.code ?? 'prod', '1042', 'employee', 'جوشکار', '26', '10'].map(
                    (v, i) => (
                      <td key={i} className="px-2 py-1.5 whitespace-nowrap" dir="auto">{v}</td>
                    )
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-sm text-muted-foreground">
            {departments.map((d) => (
              <span key={d.code} className="inline-block me-4">
                <span className="font-mono" dir="ltr">{d.code}</span> = {locale === 'fa' ? d.name_fa : d.name_en}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stage 2 — upload + validation preview */}
      <Card>
        <CardContent className="space-y-4">
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file"
            aria-label={labels.upload}
            className="block w-full text-sm file:me-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground file:cursor-pointer"
            onChange={(e) => onFile(e.target.files?.[0])}
          />

          {fileLoaded && (
            <div className="space-y-3" data-testid="import-preview">
              <p className="text-sm">
                <span className="text-success font-medium">
                  {labels.rowsValid}: {rows.length}
                </span>
                {errors.length > 0 && (
                  <span className="text-destructive font-medium ms-4">
                    {labels.rowsInvalid}: {errors.length}
                  </span>
                )}
              </p>

              {errors.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-destructive/30">
                  <table className="w-full text-sm" data-testid="import-errors">
                    <thead className="border-b bg-destructive/5">
                      <tr>
                        <th className="text-start px-3 py-2 font-semibold">{labels.line}</th>
                        <th className="text-start px-3 py-2 font-semibold">{labels.problem}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {errors.map((err, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{err.line}</td>
                          <td className="px-3 py-2 text-destructive">
                            {labels.errors[err.messageKey]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {serverError && (
                <p
                  role="alert"
                  className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm"
                >
                  {labels.errorLabel}: {serverError}
                </p>
              )}

              <Button
                onClick={runImport}
                disabled={pending || errors.length > 0 || rows.length === 0}
                data-testid="import-submit"
              >
                {pending ? labels.importing : `${labels.import} (${rows.length})`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
