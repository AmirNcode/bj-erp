'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createEmployee } from '@/lib/actions/employees';

type Department = { id: string; name_fa: string; name_en: string };
type Manager = { id: string; full_name: string; employee_code: string };

const ROLES = ['admin', 'manager', 'employee', 'security'] as const;
type Role = (typeof ROLES)[number];

type Props = {
  departments: Department[];
  managers: Manager[];
  locale: string;
  labels: {
    code: string;
    name: string;
    department: string;
    manager: string;
    roles: string;
    hireDate: string;
    submit: string;
    cancel: string;
    tempPasswordLabel: string;
    tempPasswordHint: string;
    errorLabel: string;
    selectDept: string;
    selectMgr: string;
    noneOption: string;
  };
};

export function NewEmployeeForm({ departments, managers, locale, labels }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(['employee']);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const fd = new FormData(e.currentTarget);
    const result = await createEmployee({
      employee_code: (fd.get('employee_code') as string).trim(),
      full_name: (fd.get('full_name') as string).trim(),
      department_id: (fd.get('department_id') as string) || undefined,
      manager_id: (fd.get('manager_id') as string) || undefined,
      roles: selectedRoles,
      hire_date: (fd.get('hire_date') as string) || undefined,
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setTempPassword(result.tempPassword);
  }

  function toggleRole(role: Role) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  if (tempPassword) {
    return (
      <div className="rounded-xl border-2 border-green-300 bg-green-50 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-green-800">{labels.tempPasswordLabel}</h2>
        <p className="font-mono text-2xl bg-white border border-green-300 rounded-lg px-4 py-3 select-all tracking-widest">
          {tempPassword}
        </p>
        <p className="text-sm text-green-700">{labels.tempPasswordHint}</p>
        <a
          href={`/${locale}/manage/employees`}
          className="inline-block mt-4 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
          data-testid="done-link"
        >
          ✓ {labels.cancel}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <p role="alert" className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
          {labels.errorLabel}: {error}
        </p>
      )}

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="employee_code">
          {labels.code}
        </label>
        <input
          id="employee_code"
          name="employee_code"
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="full_name">
          {labels.name}
        </label>
        <input
          id="full_name"
          name="full_name"
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="department_id">
          {labels.department}
        </label>
        <select
          id="department_id"
          name="department_id"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{labels.selectDept}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {locale === 'fa' ? d.name_fa : d.name_en}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="manager_id">
          {labels.manager}
        </label>
        <select
          id="manager_id"
          name="manager_id"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{labels.selectMgr}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name} ({m.employee_code})
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="block text-sm font-medium mb-2">{labels.roles}</span>
        <div className="flex flex-wrap gap-3">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedRoles.includes(role)}
                onChange={() => toggleRole(role)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">{role}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="hire_date">
          {labels.hireDate}
        </label>
        <input
          id="hire_date"
          name="hire_date"
          type="date"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {pending ? '...' : labels.submit}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/manage/employees`)}
          className="border border-gray-300 px-6 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}
