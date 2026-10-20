import {
  Archive,
  Banknote,
  ChartNoAxesColumn,
  CircleCheck,
  DoorOpen,
  Network,
  Plane,
  Settings,
  Users,
  Workflow,
} from 'lucide-react';
import type { NavItemKey, TabKey } from '@/lib/nav/tabs';

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const NAV_ICONS: Record<TabKey, React.ReactNode> = {
  home: (
    <Svg>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
    </Svg>
  ),
  request: (
    <Svg>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </Svg>
  ),
  calendar: (
    <Svg>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </Svg>
  ),
  // FR-44: one box over two — a reporting line.
  organization: (
    <Svg>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-2h12v2" />
    </Svg>
  ),
  profile: (
    <Svg>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
    </Svg>
  ),
  // FR-56: a door — who is out today.
  absences: (
    <Svg>
      <path d="M5 21V4a1 1 0 0 1 1-1h9v18" />
      <path d="M15 5l4 1.5V21" />
      <path d="M3 21h18M12 12h.01" />
    </Svg>
  ),
  // FR-62: a banknote.
  finance: (
    <Svg>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </Svg>
  ),
  // FR-70: a plane — travel booking.
  procurement: (
    <Svg>
      <path d="M2.5 13.5l7-2.5 5.5-6.5a1.6 1.6 0 0 1 2.3 2.3L10.8 12.3l-2.5 7-1.8-1.8.9-4.1-4.1.9z" />
    </Svg>
  ),
  manage: (
    <Svg>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </Svg>
  ),
};

const itemIcon = { size: 20, strokeWidth: 1.8, 'aria-hidden': true } as const;

/** Icons for the side panel's Manage group and Settings (lucide-react). */
export const NAV_ITEM_ICONS: Record<NavItemKey, React.ReactNode> = {
  employees: <Users {...itemIcon} />,
  departments: <Network {...itemIcon} />,
  approvals: <CircleCheck {...itemIcon} />,
  requests: <Archive {...itemIcon} />,
  approvalSteps: <Workflow {...itemIcon} />,
  reports: <ChartNoAxesColumn {...itemIcon} />,
  absences: <DoorOpen {...itemIcon} />,
  finance: <Banknote {...itemIcon} />,
  procurement: <Plane {...itemIcon} />,
  settings: <Settings {...itemIcon} />,
};
