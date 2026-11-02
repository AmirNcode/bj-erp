import { useEffect, useRef, useState } from 'react';
import { PersonSearch } from 'bj-erp';

const people = [
  { id: '1', name: 'محمد رضایی', personnelNo: '104' },
  { id: '2', name: 'محمدعلی کریمی', personnelNo: '118' },
  { id: '3', name: 'زهرا محمدی', personnelNo: '124' },
  { id: '4', name: 'علی احمدی', personnelNo: '131' },
  { id: '5', name: 'سارا نوری', personnelNo: null },
];

export const Empty = () => {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="w-80">
      <PersonSearch people={people} value={value} onChange={setValue} testId="ps-empty" ariaLabel="جانشین" />
    </div>
  );
};

export const Selected = () => {
  const [value, setValue] = useState<string | null>('3');
  return (
    <div className="w-80">
      <PersonSearch people={people} value={value} onChange={setValue} testId="ps-selected" ariaLabel="جانشین" />
    </div>
  );
};

/** Types «محمد» on mount so the suggestion list is visible (3 matches, sorted by personnel number). */
export const Results = () => {
  const [value, setValue] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = box.current?.querySelector('input');
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'محمد');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);
  return (
    <div ref={box} className="h-56 w-80">
      <PersonSearch people={people} value={value} onChange={setValue} testId="ps-results" ariaLabel="جانشین" />
    </div>
  );
};

export const Disabled = () => (
  <div className="w-80">
    <PersonSearch people={people} value="1" onChange={() => {}} testId="ps-disabled" ariaLabel="جانشین" disabled />
  </div>
);
