'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateEmployee, setRoles, setActive, resetPassword } from '@/lib/actions/employees';

type Department = { id: string; name_fa: string; name_en: string };
type Manager = { id: string; full_name: string; employee_code: string };
type Profile = {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  manager_id: string | null;
  hire_date: string | null;
  active: boolean;
  language_pref: string;
  calendar_pref: string;
};

const ALL_ROLES = ['admin', 'manager', 'employee', 'security'] as const;
type Role = (typeof ALL_ROLES)[number];

type Props = {
  employee: Profile;
  empRoles: string[];
  isAdmin: boolean;
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
    save: string;
    cancel: string;
    resetPwd: string;
    activate: string;
    deactivate: string;
    tempPasswordLabel: string;
    tempPasswordHint: string;
    errorLabel: string;
    selectDept: string;
    selectMgr: string;
    noneOption: string;
    saved: string;
    managerNote?: string;
  };
};

export function EditEmployeeForm({
  employee,
  empRoles,
  isAdmin,
  departments,
  managers,
  locale,
  labels,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(
    (empRoles as Role[]).filter((r) => ALL_ROLES.includes(r))
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);

    const fd = new FormData(e.currentTarget);

    // Update basic fields
    const result = await updateEmployee(employee.id, {
      full_name: (fd.get('full_name') as string).trim(),
      hire_date: (fd.get('hire_date') as string) || null,
      ...(isAdmin
        ? {
            department_id: (fd.get('department_id') as string) || null,
            manager_id: (fd.get('manager_id') as string) || null,
          }
        : {}),
    });

    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    // Update roles if admin
    if (isAdmin) {
      const rolesResult = await setRoles(employee.id, selectedRoles);
      if (!rolesResult.ok) {
        setPending(false);
        setError(rolesResult.error);
        return;
      }
    }

    setPending(false);
    setSuccess(true);
  }

  async function handleResetPassword() {
    setError(null);
    setPending(true);
    const result = await resetPassword(employee.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewTempPassword(result.tempPassword);
  }

  async function handleToggleActive() {
    setError(null);
    setPending(true);
    const result = await setActive(employee.id, !employee.active);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function toggleRole(role: Role) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  return (
    <div className="space-y-6">
      {!isAdmin && labels.managerNote && (
        <p className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm">
          {labels.managerNote}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
          {labels.errorLabel}: {error}
        </p>
      )}
      {success && (
        <p role="status" className="bg-green-50 border border-green-300 text-green-700 px-4 py-3 rounded-lg text-sm">
          {labels.saved}
        </p>
      )}
      {newTempPassword && (
        <div className="rounded-xl border-2 border-green-300 bg-green-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800">{labels.tempPasswordLabel}</p>
          <p className="font-mono text-xl bg-white border border-green-300 rounded-lg px-4 py-2 select-all tracking-widest">
            {newTempPassword}
          </p>
          <p className="text-xs text-green-700">{labels.tempPasswordHint}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="full_name">
            {labels.name}
          </label>
          <input
            id="full_name"
            name="full_name"
            required
            defaultValue={employee.full_name}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="hire_date">
            {labels.hireDate}
          </label>
          <input
            id="hire_date"
            name="hire_date"
            type="date"
            defaultValue={employee.hire_date ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {isAdmin && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="department_id">
                {labels.department}
              </label>
              <select
                id="department_id"
                name="department_id"
                defaultValue={employee.department_id ?? ''}
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
                defaultValue={employee.manager_id ?? ''}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{labels.noneOption}</option>
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
                {ALL_ROLES.map((role) => (
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
          </>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {pending ? '...' : labels.save}
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

      {isAdmin && (
        <div className="border-t border-gray-200 pt-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Admin actions</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleResetPassword}
              disabled={pending}
              className="border border-orange-300 text-orange-700 px-4 py-2 rounded-lg hover:bg-orange-50 disabled:opacity-50 transition-colors text-sm"
            >
              {labels.resetPwd}
            </button>
            <button
              onClick={handleToggleActive}
              disabled={pending}
              className={`px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 ${
                employee.active
                  ? 'border border-red-300 text-red-700 hover:bg-red-50'
                  : 'border border-green-300 text-green-700 hover:bg-green-50'
              }`}
            >
              {employee.active ? labels.deactivate : labels.activate}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
