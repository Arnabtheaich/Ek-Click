"use strict";

// Representative Classroom Stream card structure: each announcement has its
// own options control and inline Drive attachment cards. IDs and titles mimic
// labels exposed by the live Classroom accessibility tree.
module.exports = {
  url: "https://classroom.google.com/u/3/c/course-42",
  course: "Physics 101",
  announcements: [
    { id: "stream-101", menu: "Announcement options for Date:19.10.2026 Programming Exercise", files: [
      { id: "drive-pdf-1", name: "Problem 01.pdf", label: "Attachment: PDF: Problem 01.pdf" },
      { id: "drive-pdf-2", name: "Problem 02.pdf", label: "Attachment: PDF: Problem 02.pdf" },
      { id: "drive-pdf-3", name: "Problem 03.pdf", label: "Attachment: PDF: Problem 03.pdf" }
    ] },
    { id: "stream-102", menu: "Announcement options for Date:15.10.2026 Module 02: Lecture 08", files: [
      { id: "drive-video-1", name: "Lecture 08.mp4", label: "Attachment: Video: Lecture 08.mp4" }
    ] }
  ]
};
