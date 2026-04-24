// ─────────────────────────────────────────────────────────────
// STANDARD API RESPONSE HELPERS
// Every API response follows the same shape so the frontend
// can handle them consistently.
// ─────────────────────────────────────────────────────────────

const success = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

const created = (res, data = {}, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

const error = (res, message = 'An error occurred', statusCode = 400, details = null) => {
  const body = {
    success:   false,
    error:     message,
    timestamp: new Date().toISOString(),
  };
  if (details && process.env.NODE_ENV !== 'production') {
    body.details = details;
  }
  return res.status(statusCode).json(body);
};

const notFound = (res, message = 'Resource not found') => {
  return error(res, message, 404);
};

const unauthorized = (res, message = 'Unauthorised. Please login again.') => {
  return error(res, message, 401);
};

const forbidden = (res, message = 'Access denied.') => {
  return error(res, message, 403);
};

const serverError = (res, message = 'Internal server error', details = null) => {
  return error(res, message, 500, details);
};

const validationError = (res, errors) => {
  return res.status(422).json({
    success:   false,
    error:     'Validation failed',
    errors,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  success, created, error,
  notFound, unauthorized, forbidden,
  serverError, validationError,
};
