import React from "react";
import "./Preloader.css";

const Preloader = ({ fadeOut }) => {
  return (
    <div className={`preloader ${fadeOut ? "fade-out" : ""}`}>
      <div className="preloader-video" aria-hidden="true" />
      <div className="preloader-overlay" />
    </div>
  );
};

export default Preloader;
