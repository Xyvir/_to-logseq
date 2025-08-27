interface Usage {
  requests: number;
}

class ApiUsageTracker {
  private usage: Usage = {
    requests: 0,
  };
  private listeners: Array<(usage: Usage) => void> = [];

  public incrementRequests() {
    this.usage.requests++;
    this.notifyListeners();
  }

  public getUsage(): Usage {
    return { ...this.usage };
  }

  public subscribe(listener: (usage: Usage) => void): () => void {
    this.listeners.push(listener);
    // Immediately notify new subscriber with current state
    listener(this.usage);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.getUsage()));
  }
}

export const apiUsageTracker = new ApiUsageTracker();
