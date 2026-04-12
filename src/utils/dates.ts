export const getNextBusinessDays = (count: number) => {
  const days: Date[] = [];
  let current = new Date();
  
  // Siempre incluir hoy
  days.push(new Date(current));
  
  // Buscar los siguientes días hábiles
  while (days.length < count) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(new Date(current));
    }
  }
  return days;
};

export const formatDateId = (date: Date) => {
  return date.toISOString().split('T')[0];
};

export const formatDisplayDate = (date: Date) => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  
  const now = new Date();
  const isToday = formatDateId(date) === formatDateId(now);
  
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = formatDateId(date) === formatDateId(tomorrow);
  
  if (isToday) return 'Hoy';
  if (isTomorrow) return 'Mañana';
  
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
};
