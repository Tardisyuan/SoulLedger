"""
Social domain permission classes.
"""
from rest_framework import permissions


class IsAuthorOrReadOnly(permissions.BasePermission):
    """
    Object-level permission: only the author of a post/comment can modify it.
    Read-only access is allowed for any authenticated user (tenant isolation
    is handled at the view level).
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        # obj.author may not exist on all models — check gracefully
        author = getattr(obj, "author", None)
        if author is None:
            return True
        return author.pk == request.user.pk


class IsReactionOwnerOrReadOnly(permissions.BasePermission):
    """
    Object-level permission for reactions: only the user who created
    the reaction can modify or delete it.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.user_id == request.user.pk


class IsFollowOwnerOrReadOnly(permissions.BasePermission):
    """
    Object-level permission for follows: only the follower can delete
    their own follow relationship.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.follower_id == request.user.pk


class IsProfileOwnerOrReadOnly(permissions.BasePermission):
    """
    Object-level permission for user profiles: only the profile owner
    can update their own profile.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.user_id == request.user.pk
