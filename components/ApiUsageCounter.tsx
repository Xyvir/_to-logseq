import React, { useState, useEffect } from 'react';
import { apiUsageTracker } from '../services/apiUsageService';

const ApiUsageCounter: React.FC = () => {
    const [requests, setRequests] = useState(0);

    useEffect(() => {
        const unsubscribe = apiUsageTracker.subscribe(usage => {
            setRequests(usage.requests);
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="fixed bottom-4 right-4 bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-lg px-4 py-2 text-xs text-slate-400 shadow-lg z-50 animate-fade-in">
            <p>
                <span className="font-semibold text-slate-300">API Calls (This Session):</span> {requests}
            </p>
            <p className="text-slate-500 mt-1">
                Note: This is an unofficial count and resets on refresh. Check your Google AI Studio dashboard for official daily usage.
            </p>
        </div>
    );
};

export default ApiUsageCounter;
