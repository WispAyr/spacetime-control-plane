import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react';
import { SpacetimeClient, type SpacetimeInstance, type TableSchema, type ReducerSchema } from '../lib/spacetime-client';

interface ConnectionState {
    instances: SpacetimeInstance[];
    activeInstanceId: string | null;
    activeDatabase: string | null;
    knownDatabases: string[];
    client: SpacetimeClient | null;
    tables: TableSchema[];
    reducers: ReducerSchema[];
}

interface ConnectionActions {
    connect: (url: string, name?: string, database?: string) => Promise<void>;
    disconnect: (instanceId: string) => void;
    setActiveInstance: (instanceId: string) => void;
    setActiveDatabase: (nameOrIdentity: string) => void;
    addDatabase: (nameOrIdentity: string) => void;
    refreshSchema: () => Promise<void>;
}

const ConnectionContext = createContext<(ConnectionState & ConnectionActions) | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<ConnectionState>({
        instances: [],
        activeInstanceId: null,
        activeDatabase: null,
        knownDatabases: [],
        client: null,
        tables: [],
        reducers: [],
    });

    const connect = useCallback(async (url: string, name?: string, database?: string) => {
        const id = crypto.randomUUID();
        const client = new SpacetimeClient(url);

        setState(prev => ({
            ...prev,
            instances: [
                ...prev.instances,
                { id, name: name || url, url, status: 'connecting' as const },
            ],
        }));

        try {
            const isAlive = await client.ping();
            if (!isAlive) throw new Error('Instance unreachable');

            let tables: TableSchema[] = [];
            let reducers: ReducerSchema[] = [];
            const knownDbs: string[] = [];

            if (database) {
                try {
                    const schema = await client.getSchema(database);
                    tables = schema.tables;
                    reducers = schema.reducers;
                    knownDbs.push(database);
                } catch (err) {
                    console.warn('Failed to load schema on connect:', err);
                }
            }

            setState(prev => ({
                ...prev,
                instances: prev.instances.map(i =>
                    i.id === id ? { ...i, status: 'connected' as const } : i
                ),
                activeInstanceId: id,
                activeDatabase: database || null,
                knownDatabases: [...new Set([...prev.knownDatabases, ...knownDbs])],
                client,
                tables,
                reducers,
            }));
        } catch (err) {
            setState(prev => ({
                ...prev,
                instances: prev.instances.map(i =>
                    i.id === id
                        ? { ...i, status: 'error' as const, error: String(err) }
                        : i
                ),
            }));
        }
    }, []);

    const disconnect = useCallback((instanceId: string) => {
        setState(prev => ({
            ...prev,
            instances: prev.instances.filter(i => i.id !== instanceId),
            activeInstanceId: prev.activeInstanceId === instanceId ? null : prev.activeInstanceId,
            activeDatabase: prev.activeInstanceId === instanceId ? null : prev.activeDatabase,
            client: prev.activeInstanceId === instanceId ? null : prev.client,
            tables: prev.activeInstanceId === instanceId ? [] : prev.tables,
            reducers: prev.activeInstanceId === instanceId ? [] : prev.reducers,
        }));
    }, []);

    const setActiveInstance = useCallback((instanceId: string) => {
        const instance = state.instances.find(i => i.id === instanceId);
        if (!instance) return;

        setState(prev => ({
            ...prev,
            activeInstanceId: instanceId,
            client: new SpacetimeClient(instance.url),
            activeDatabase: null,
            tables: [],
            reducers: [],
        }));
    }, [state.instances]);

    const setActiveDatabase = useCallback(async (nameOrIdentity: string) => {
        if (!state.client) return;

        try {
            const schema = await state.client.getSchema(nameOrIdentity);
            setState(prev => ({
                ...prev,
                activeDatabase: nameOrIdentity,
                knownDatabases: [...new Set([...prev.knownDatabases, nameOrIdentity])],
                tables: schema.tables,
                reducers: schema.reducers,
            }));
        } catch (err) {
            console.error('Failed to load schema:', err);
            setState(prev => ({
                ...prev,
                activeDatabase: nameOrIdentity,
                tables: [],
                reducers: [],
            }));
        }
    }, [state.client]);

    const addDatabase = useCallback((nameOrIdentity: string) => {
        setState(prev => ({
            ...prev,
            knownDatabases: [...new Set([...prev.knownDatabases, nameOrIdentity])],
        }));
    }, []);

    const refreshSchema = useCallback(async () => {
        if (!state.client || !state.activeDatabase) return;
        try {
            const schema = await state.client.getSchema(state.activeDatabase);
            setState(prev => ({
                ...prev,
                tables: schema.tables,
                reducers: schema.reducers,
            }));
        } catch (err) {
            console.error('Failed to refresh schema:', err);
        }
    }, [state.client, state.activeDatabase]);

    useEffect(() => {
        if (!state.activeDatabase || !state.client) return;
        const interval = setInterval(refreshSchema, 10000);
        return () => clearInterval(interval);
    }, [state.activeDatabase, state.client, refreshSchema]);

    const value = {
        ...state,
        connect,
        disconnect,
        setActiveInstance,
        setActiveDatabase,
        addDatabase,
        refreshSchema,
    };

    return (
        <ConnectionContext.Provider value={value}>
            {children}
        </ConnectionContext.Provider>
    );
}

export function useConnection() {
    const ctx = useContext(ConnectionContext);
    if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
    return ctx;
}
