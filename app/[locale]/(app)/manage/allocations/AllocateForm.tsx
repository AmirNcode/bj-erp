'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { allocateLeave } from '@/lib/actions/leave';
import type { EmployeeOption, LeaveType } from '@/lib/actions/leave';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { nativeSelectClass } from '@/lib/native-select';

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
        toast.success(labels.success);
        setEmployeeId('');
        setLeaveTypeId('');
        setPeriodStart('');
        setPeriodEnd('');
        setDays('');
      } else {
        setErrorMsg(res.error);
        toast.error(res.error);
      }
    });
  };

  return (
    <Card data-testid="allocate-form">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Employee — native <select> preserved for Playwright selectOption e2e */}
          <div className="space-y-1.5">
            <Label htmlFor="alloc_employee">{labels.employee}</Label>
            <select
              id="alloc_employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={nativeSelectClass}
            >
              <option value="">{labels.selectEmployee}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </div>

          {/* Leave type — native <select> preserved for Playwright selectOption e2e */}
          <div className="space-y-1.5">
            <Label htmlFor="alloc_leave_type">{labels.leaveType}</Label>
            <select
              id="alloc_leave_type"
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
              className={nativeSelectClass}
            >
              <option value="">{labels.selectType}</option>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name_fa}
                </option>
              ))}
            </select>
          </div>

          {/* Period start — native date input preserved for Playwright fill e2e */}
          <div className="space-y-1.5">
            <Label htmlFor="alloc_period_start">{labels.periodStart}</Label>
            <Input
              id="alloc_period_start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>

          {/* Period end — native date input preserved for Playwright fill e2e */}
          <div className="space-y-1.5">
            <Label htmlFor="alloc_period_end">{labels.periodEnd}</Label>
            <Input
              id="alloc_period_end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>

          {/* Days */}
          <div className="space-y-1.5">
            <Label htmlFor="alloc_days">{labels.days}</Label>
            <Input
              id="alloc_days"
              type="number"
              min="0.5"
              step="0.5"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              data-testid="alloc-days-input"
            />
          </div>

          {/* Success callout — kept visible for e2e waits */}
          {successMsg && (
            <div
              className="rounded-lg bg-success-foreground border border-success/20 px-4 py-3 text-sm text-success"
              data-testid="alloc-success"
            >
              {successMsg}
            </div>
          )}

          {/* Inline error */}
          {errorMsg && (
            <div
              className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive"
              data-testid="alloc-error"
            >
              <strong>{labels.errorLabel}:</strong> {errorMsg}
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full"
            data-testid="alloc-submit"
          >
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
