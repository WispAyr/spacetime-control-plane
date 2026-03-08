export default function PlaceholderPage({ title, icon, description }: { title: string; icon: string; description: string }) {
    return (
        <div className="app-content">
            <div className="panel" style={{ flex: 1 }}>
                <div className="empty-state" style={{ height: '100%' }}>
                    <div className="icon">{icon}</div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <span className="badge badge-amber">Coming Soon</span>
                </div>
            </div>
        </div>
    );
}
