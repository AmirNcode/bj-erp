'use server';

import { createClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/auth/context';
import type { TeamDirectoryMember } from '@/lib/home/board';

type TeamDirectoryRow = {
  profile_id: string;
  full_name: string;
  employee_code: string;
  relation: string;
  roles: string[] | null;
  department_name_fa: string | null;
  department_name_en: string | null;
  manager_name: string | null;
};

export async function getMyTeamDirectory(): Promise<
  { ok: true; members: TeamDirectoryMember[] } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase.rpc('get_my_team_directory');
  if (error) return { ok: false, error: error.message };

  const members: TeamDirectoryMember[] = ((data ?? []) as TeamDirectoryRow[]).map((row) => {
    const relation: TeamDirectoryMember['relation'] =
      row.relation === 'manager' ? 'manager' : 'teammate';

    return {
      id: row.profile_id,
      fullName: row.full_name,
      employeeCode: row.employee_code,
      relation,
      roles: row.roles ?? [],
      departmentNameFa: row.department_name_fa,
      departmentNameEn: row.department_name_en,
      managerName: row.manager_name,
    };
  });

  return { ok: true, members };
}
