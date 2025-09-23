"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewType = exports.ClassGroup = exports.SchoolLevel = void 0;
var SchoolLevel;
(function (SchoolLevel) {
    SchoolLevel["Middle"] = "Ortaokul";
    SchoolLevel["High"] = "Lise";
})(SchoolLevel || (exports.SchoolLevel = SchoolLevel = {}));
var ClassGroup;
(function (ClassGroup) {
    ClassGroup["None"] = "Yok";
    ClassGroup["TM"] = "TM";
    ClassGroup["Dil"] = "D\u0130L";
    ClassGroup["Soz"] = "SOS";
    ClassGroup["Fen"] = "FEN";
})(ClassGroup || (exports.ClassGroup = ClassGroup = {}));
var ViewType;
(function (ViewType) {
    ViewType[ViewType["Class"] = 0] = "Class";
    ViewType[ViewType["Teacher"] = 1] = "Teacher";
})(ViewType || (exports.ViewType = ViewType = {}));
