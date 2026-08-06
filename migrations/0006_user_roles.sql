-- One login for everyone: customers and admins live in the same table,
-- and the role column decides what a session may reach.

alter table customers
  add column if not exists role text not null default 'customer'
  check (role in ('customer', 'admin'));
