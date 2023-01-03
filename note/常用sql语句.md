

### 1、转换时间的

```
//转换时间的

select floor(create_time / 86400) as c, count(*) from `user` group by c



select date_format(from_unixtime(create_time), '%Y-%m-%d') today, count(*) as cnt from user group by today
```



