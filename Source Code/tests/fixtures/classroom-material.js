"use strict";
module.exports = {
  url: "https://classroom.google.com/u/0/c/course-42/m/material-7/details",
  course: "Physics 101",
  topic: "Week 4: Motion",
  descriptors: [
    { url: "https://drive.google.com/file/d/video-11/view?usp=drive_link", candidates: ["Video", "Motion lecture 04.mp4", "18 MB"], typeHint: "Video" },
    { url: "https://drive.google.com/file/d/pdf-21/view?usp=sharing", candidates: ["PDF", "Worksheet A.pdf"], typeHint: "PDF" },
    { url: "https://drive.google.com/open?id=pdf-22", candidates: ["Open PDF", "Worksheet B.pdf"], typeHint: "PDF" },
    { url: "https://drive.usercontent.google.com/download?id=pdf-23&export=download", candidates: ["Problem set.pdf"], typeHint: "PDF" },
    { url: "https://drive.google.com/file/d/pdf-21/view?authuser=0", candidates: ["Worksheet A.pdf"], typeHint: "PDF" },
    { url: "https://drive.google.com/drive/folders/not-an-attachment", candidates: ["Class folder"] },
    { url: "https://classroom.google.com/u/0/c/course-42", candidates: ["Course navigation"] },
    { url: "https://accounts.google.com/SignOutOptions", candidates: ["Profile"] },
    { url: "https://docs.google.com/document/d/doc-99/edit", candidates: ["Google Doc", "Lab notes"] },
    { url: "https://docs.google.com/spreadsheets/d/sheet-98/edit", candidates: ["Google Sheet", "Budget.xlsx"] },
    { url: "https://docs.google.com/presentation/d/slide-97/edit", candidates: ["Google Slides", "Seminar.pptx"] }
  ]
};
