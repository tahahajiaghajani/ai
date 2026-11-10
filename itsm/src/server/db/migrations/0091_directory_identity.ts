// Directory links remember the directory object itself (Active Directory objectGUID, OpenLDAP entryUUID), not only its
// name: a new person given a former employee's DN never opens that employee's account, and a person whose DN moved
// keeps theirs (sm_directory_links.object_id, filled by sign-ins and synchronisations).
export default /* sql */ `
alter table sm_directory_links add column if not exists object_id text;
create index if not exists sm_directory_links_object_idx on sm_directory_links (source_id, kind, object_id) where object_id is not null;
`;
