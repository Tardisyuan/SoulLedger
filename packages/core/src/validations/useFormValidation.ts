import { z } from 'zod'
import { useState, useCallback } from 'react'

export interface ValidationResult<T> {
  success: boolean
  data?: T
  errors?: Record<string, string>
}

export function useFormValidation<T extends z.ZodType>(schema: T) {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = useCallback(
    (data: unknown): ValidationResult<z.infer<T>> => {
      const result = schema.safeParse(data)

      if (!result.success) {
        const fieldErrors: Record<string, string> = {}
        result.error.issues.forEach((issue) => {
          const path = issue.path.join('.')
          // Only keep the first error for each field
          if (!fieldErrors[path]) {
            fieldErrors[path] = issue.message
          }
        })
        setErrors(fieldErrors)
        return { success: false, errors: fieldErrors }
      }

      setErrors({})
      return { success: true, data: result.data }
    },
    [schema]
  )

  const validateField = useCallback(
    (fieldPath: string, value: unknown): string | null => {
      try {
        // Only this field's issues count: the other keys are absent here, so a required sibling always
        // fails the parse, and judging by `success` would mark a valid field with an empty error.
        const result = schema.safeParse({ [fieldPath]: value })
        const fieldIssue = result.success
          ? undefined
          : result.error.issues.find((issue) => issue.path.join('.') === fieldPath)
        if (fieldIssue) {
          setErrors((prev) => ({ ...prev, [fieldPath]: fieldIssue.message }))
          return fieldIssue.message
        }
        setErrors((prev) => {
          const { [fieldPath]: _, ...rest } = prev
          return rest
        })
        return null
      } catch {
        return null
      }
    },
    [schema]
  )

  const clearErrors = useCallback(() => setErrors({}), [])

  const clearFieldError = useCallback((fieldPath: string) => {
    setErrors((prev) => {
      const { [fieldPath]: _, ...rest } = prev
      return rest
    })
  }, [])

  const getError = useCallback(
    (fieldPath: string): string | undefined => {
      return errors[fieldPath]
    },
    [errors]
  )

  const hasErrors = useCallback((): boolean => {
    return Object.keys(errors).length > 0
  }, [errors])

  return {
    validate,
    validateField,
    clearErrors,
    clearFieldError,
    getError,
    hasErrors,
    errors,
  }
}
