//where the backend lives. locally thats your own machine, in production its
//whatever url you set as VITE_API_URL in the hosts dashboard.
//vite bakes this in at build time, so changing it means redeploying
export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
