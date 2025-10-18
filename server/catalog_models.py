from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


def _ensure_matrix(value: List[List[bool]]) -> List[List[bool]]:
    normalized: List[List[bool]] = []
    for row in value:
        if isinstance(row, list):
            normalized.append([bool(cell) for cell in row])
    return normalized


class TeacherPayload(BaseModel):
    id: str = Field(..., description="UI'da kullanılan teacher_id")
    name: str
    branches: List[str] = Field(default_factory=list)
    availability: List[List[bool]] = Field(default_factory=list)
    canTeachMiddleSchool: bool = True
    canTeachHighSchool: bool = False
    metadata: Optional[Dict[str, Any]] = None
    isArchived: bool = False

    @field_validator("availability")
    @classmethod
    def _normalize_matrix(cls, value: List[List[bool]]) -> List[List[bool]]:
        return _ensure_matrix(value)


class TeacherRecord(TeacherPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class ClassroomPayload(BaseModel):
    id: str
    name: str
    level: str
    group: Optional[str] = None
    homeroomTeacherId: Optional[str] = None
    sessionType: str = "full"
    metadata: Optional[Dict[str, Any]] = None
    isArchived: bool = False


class ClassroomRecord(ClassroomPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class LocationPayload(BaseModel):
    id: str
    name: str
    metadata: Optional[Dict[str, Any]] = None
    isArchived: bool = False


class LocationRecord(LocationPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class SubjectPayload(BaseModel):
    id: str
    name: str
    weeklyHours: int
    blockHours: int = 0
    tripleBlockHours: int = 0
    maxConsec: Optional[int] = None
    locationId: Optional[str] = None
    requiredTeacherCount: int = 1
    assignedClassIds: List[str] = Field(default_factory=list)
    pinnedTeacherByClassroom: Dict[str, List[str]] = Field(default_factory=dict)
    metadata: Optional[Dict[str, Any]] = None
    isArchived: bool = False

    @field_validator("assignedClassIds", mode="before")
    @classmethod
    def _ensure_list(cls, value: Any) -> List[str]:
        if value is None:
            return []
        return [str(item) for item in value]


class SubjectRecord(SubjectPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class FixedAssignmentPayload(BaseModel):
    id: str
    classroomId: str
    subjectId: str
    dayIndex: int
    hourIndex: int
    metadata: Optional[Dict[str, Any]] = None


class FixedAssignmentRecord(FixedAssignmentPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class LessonGroupPayload(BaseModel):
    id: str
    name: str
    subjectId: str
    classroomIds: List[str] = Field(default_factory=list)
    weeklyHours: int
    isBlock: bool = False
    metadata: Optional[Dict[str, Any]] = None


class LessonGroupRecord(LessonGroupPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class DutyPayload(BaseModel):
    id: str
    teacherId: str
    name: str
    dayIndex: int
    hourIndex: int
    metadata: Optional[Dict[str, Any]] = None


class DutyRecord(DutyPayload):
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class SchoolSettingsPayload(BaseModel):
    schoolHours: Optional[Dict[str, List[int]]] = None
    preferences: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class SchoolSettingsRecord(SchoolSettingsPayload):
    updatedAt: Optional[datetime] = None

