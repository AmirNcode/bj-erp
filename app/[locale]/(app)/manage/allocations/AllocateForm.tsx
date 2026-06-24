'use client';

import { useState, useTransition } from 'react';
import { allocateLeave } from '@/lib/actions/leave';
import type { EmployeeOption, LeaveType } from '@/lib/actions/leave';

type Labels = {
  employee: string;
  selectEmployee: string;
  leaveType: string;
  selectType: string;
  periodStart: string;
  periodEnd: string;
  days: string;
  submit: string;
  success: string;
  errorLabel: string;
};

type Props = {
  employees: EmployeeOption[];
  leaveTypes: LeaveType[];
  labels: Labels;
  locale: string;
};

export function AllocateForm({ employees, leaveTypes, labels }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [days, setDays] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const daysNum = parseFloat(days);
    if (!employeeId || !leaveTypeId || !periodStart || !periodEnd || !daysNum) {
      setErrorMsg('All fields are required.');
      return;
    }

    startTransition(async () => {
      const res = await allocateLeave({
        employeeId,
        leaveTypeId,
        periodStart,
        periodEnd,
        days: daysNum,
      });

      if (res.ok) {
        setSuccessMsg(labels.success);
        setEmployeeId('');
        setLeaveTypeId('');
        setPeriodStart('');
        setPeriodEnd('');
        setDays('');
      } else {
        setErrorMsg(res.error);
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 bg-white rounded-xl border border-gray-200 p-6"
      data-testid="allocate-form"
    >
      {/* Employee */}
      <div>
        <label htmlFor="alloc_employee" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.employee}
        </label>
        <select
          id="alloc_employee"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{labels.selectEmployee}</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name} ({emp.employee_code})
            </option>
          ))}
        </select>
      </div>

      {/* Leave type */}
      <div>
        <label htmlFor="alloc_leave_type" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.leaveType}
        </label>
        <select
          id="alloc_leave_type"
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{labels.selectType}</option>
          {leaveTypes.map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name_fa}
            </option>
          ))}
        </select>
      </div>

      {/* Period start */}
      <div>
        <label htmlFor="alloc_period_start" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.periodStart}
        </label>
        <input
          id="alloc_period_start"
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Period end */}
      <div>
        <label htmlFor="alloc_period_end" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.periodEnd}
        </label>
        <input
          id="alloc_period_end"
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Days */}
      <div>
        <label htmlFor="alloc_days" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.days}
        </label>
        <input
          id="alloc_days"
          type="number"
          min="0.5"
          step="0.5"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="alloc-days-input"
        />
      </div>

      {successMsg && (
        <div
          className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800"
          data-testid="alloc-success"
        >
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div
          className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800"
          data-testid="alloc-error"
        >
          <strong>{labels.errorLabel}:</strong> {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        data-testid="alloc-submit"
      >
        {isPending ? '...' : labels.submit}
      </button>
    </form>
  );
}
