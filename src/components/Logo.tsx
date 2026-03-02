import React from 'react';

export const LokalyzeLogo = () => (
    <div className="flex items-center">
        {/* Light Mode Logo */}
        <img
            src="https://images.groovetech.io/MBRWxrOdcYHWs9eA_IDQeFx0yJFoxKQ3gvF8AZaow2w/rs:fit:0:0:0/g:no:0:0/c:0:0/aHR0cHM6Ly9hc3NldHMuZ3Jvb3ZlYXBwcy5jb20vaW1hZ2VzLzVlYmFjMjNkNzNlZjNlMTk2ZTk3Y2E5Mi8xNzY5NDM3NTc4X2xva2FseXplYmxhY2sucG5n.webp"
            alt="LOKALYZE"
            className="h-8 w-auto dark:hidden block"
        />
        {/* Dark Mode Logo */}
        <img
            src="https://images.groovetech.io/wVZH-b1TUX2lwQziJSg-w5_p1OZoYG-xmeGY4n37NFU/rs:fit:0:0:0/g:no:0:0/c:0:0/aHR0cHM6Ly9hc3NldHMuZ3Jvb3ZlYXBwcy5jb20vaW1hZ2VzLzVlYmFjMjNkNzNlZjNlMTk2ZTk3Y2E5Mi8xNzY5NDM3NTgyX2xva2FseXpld2hpdGUucG5n.webp"
            alt="LOKALYZE"
            className="h-8 w-auto hidden dark:block"
        />
    </div>
);

export const ApxlbsLogo = () => (
    <a
        href="https://apxlbs.com"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity group"
    >
        <img
            src="https://images.groovetech.io/RFoZ0y1eg3_uT7xQLKwlSy0NUtrO2B5-8L8Z1vjVvSw/rs:fit:0:0:0/g:no:0:0/c:0:0/aHR0cHM6Ly9hc3NldHMuZ3Jvb3ZlYXBwcy5jb20vaW1hZ2VzLzVlYmFjMjNkNzNlZjNlMTk2ZTk3Y2E5Mi8xNzY5NDM3NTkwX3Bvd2VyZWRieWFweGxic2JsYWNrLnBuZw.webp"
            alt="Powered by apxlbs"
            className="h-5 w-auto dark:hidden block"
        />
        <img
            src="https://images.groovetech.io/zLwliusigqNxj8mZZkkiPiY56BB1ZcWvsQdiwPg1haw/rs:fit:0:0:0/g:no:0:0/c:0:0/aHR0cHM6Ly9hc3NldHMuZ3Jvb3ZlYXBwcy5jb20vaW1hZ2VzLzVlYmFjMjNkNzNlZjNlMTk2ZTk3Y2E5Mi8xNzY5NDM3NTk4X3Bvd2VyZWRieWFweGxic3doaXRlLnBuZw.webp"
            alt="Powered by apxlbs"
            className="h-5 w-auto hidden dark:block"
        />
    </a>
);
