# Roles and permissions

Who may do what in LoanDesk. The source of truth is SPEC section 4; this page copies it for staff and records what each feature changed. Every rule is checked in the database (RPCs and row-level security), not only on screen.

## Installment loans (2026-11-14): no new permissions

Installment loans use the existing roles and rights unchanged. Confirmed against the code:

| Action on an installment loan | Who | Same as |
| --- | --- | --- |
| Apply (wizard, schedule preview) | loan officer, manager | Create loan application |
| Approve | manager up to the limit (not their own), CEO above it | Approve loan ≤ / > limit |
| Pay out (schedule written) | cashier | Disburse approved loan |
| Take an installment or any other amount | cashier, manager (office); loan officer (field) | Receive payment / Record field payment |
| See the schedule, arrears and next installment | all staff (read access) | Read loans and balances |
| WhatsApp installment reminder | every role that can open the due list or Today | Reminders |
| Edit the installment product and the reminder text | admin | Manage products, settings |
| Extend | nobody: refused for installment loans in this version | (extension rights unchanged for one-payment loans) |

No new role, permission, approval type or row-level security policy was added. The new table `loan_installments` is read-only for staff (like the other ledger-linked tables); it is written only when a loan is paid out. The new functions check `is_staff()` and are on the list of released RPCs (`supabase/tests/database/01_schema_rls.test.sql`).

## Roles (SPEC 4)


Roles: `admin` (Corex technical admin), `ceo`, `manager`, `accountant`, `cashier`, `loan_officer`. One role per user; each user has a `branch_id` (nullable for ceo/admin/accountant).

**Read access:** all staff can read all customers, loans, balances and collateral across branches (client requirement). Financial reports and the ledger: `ceo`, `manager`, `accountant`, `admin`. Audit log: `ceo`, `manager`, `admin`. Writes are branch-scoped except where noted.

| Action | loan_officer | cashier | manager | accountant | ceo | admin |
| --- | --- | --- | --- | --- | --- | --- |
| Create customer | yes | no | yes | no | no | yes |
| Request customer edit | yes | yes | yes | no | no | yes |
| Approve customer edit | no | no | yes | no | yes | no |
| Create loan application | yes | no | yes | no | no | no |
| Approve loan ≤ limit | no | no | yes (not own) | no | yes | no |
| Approve loan > limit | no | no | no | no | yes | no |
| Disburse approved loan | no | yes | no | no | no | no |
| Receive payment (office) | no | yes | yes | no | no | no |
| Record field payment | yes | no | no | no | no | no |
| Confirm field remittance | no | yes | yes | no | no | no |
| Request payment void | no | yes | yes | yes | no | no |
| Approve void / reversal | no | no | yes (not own) | no | yes | no |
| Register collateral | yes | yes | yes | no | no | no |
| Release collateral (loan closed) | no | yes | yes | no | no | no |
| Open recovery case | no | no | yes | no | yes | no |
| Record collateral sale | no | no | yes | no | yes | no |
| Extend loan (request) | yes | no | yes | no | no | no |
| Approve extension | no | no | yes (not own) | no | yes | no |
| Request write-off | no | no | yes | yes | no | no |
| Approve write-off | no | no | no | no | yes | no |
| Record expense ≤ limit | no | no | yes | yes | no | no |
| Approve expense > limit | no | no | yes (not own) | no | yes | no |
| Manual journal (request) | no | no | no | yes | no | yes |
| Approve manual journal | no | no | yes | no | yes | no |
| Submit day close | no | yes | no | no | no | no |
| Approve day close | no | no | yes | no | yes | no |
| Run accruals manually | no | no | yes | no | no | yes |
| Manage users, products, settings | no | no | no | no | no | yes |
| View audit log | no | no | yes | no | yes | yes |

Segregation rules enforced in SQL (not only the UI): requester ≠ approver for every approval; loan creator ≠ loan approver; the user disbursing may be anyone with cashier role.

Approval routing is data-driven: `approval_requests.required_role` is computed by the creating function from settings (for example loan amount vs `loan_manager_limit_cents`). `ceo` can always approve anything a `manager` can.

---

