export default function DashboardLoading() {
  return (
    <div className="dashboard-route-loading" role="status" aria-label="Chargement de la page">
      <div className="dashboard-loading-heading"><i /><span><b /><b /></span></div>
      <div className="dashboard-loading-kpis">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div>
      <div className="dashboard-loading-content"><i /><i /><i /><i /><i /></div>
    </div>
  );
}
