export function TableCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="table-panel">
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="table-wrapper">{children}</div>
    </div>
  );
}

